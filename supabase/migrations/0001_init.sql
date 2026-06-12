-- ============================================================================
-- Relationship Hub — initial schema (Phase 1)
-- ----------------------------------------------------------------------------
-- Six tables: clients, users, service_models, contact_events, due_dates, tasks.
-- The service engine lives in the database as triggers, so due dates and the
-- task queue stay correct no matter where a write comes from (app, CSV import,
-- future Redtail sync).
--
-- Run this against a fresh Supabase project (SQL editor or `supabase db push`).
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type advisor_assignment as enum ('matt', 'advisor_b', 'joint');
create type user_role         as enum ('advisor', 'assistant');
create type client_tier       as enum ('A', 'B', 'C');
create type contact_type      as enum ('meeting', 'call', 'admin');
create type touch_type        as enum ('meeting', 'call');
create type task_priority     as enum ('high', 'medium', 'low');
create type task_status       as enum ('open', 'done');

-- ---------------------------------------------------------------------------
-- users — the three people in the firm. Linked to Supabase Auth by email the
-- first time each person signs up (see handle_new_auth_user below).
-- ---------------------------------------------------------------------------
create table users (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users (id) on delete set null,
  name          text not null,
  email         text unique,
  role          user_role not null,
  advisor_key   advisor_assignment check (advisor_key <> 'joint'),
  created_at    timestamptz not null default now(),
  constraint advisor_needs_key check (role <> 'advisor' or advisor_key is not null)
);

-- ---------------------------------------------------------------------------
-- clients — one row per household.
-- ---------------------------------------------------------------------------
create table clients (
  id               uuid primary key default gen_random_uuid(),
  household_name   text not null,
  assigned_advisor advisor_assignment not null default 'matt',
  tier             client_tier not null default 'B',
  active           boolean not null default true,
  redtail_id       text unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index clients_advisor_idx on clients (assigned_advisor) where active;

-- ---------------------------------------------------------------------------
-- service_models — the cadence rules per tier. Editable, not hardcoded.
-- ---------------------------------------------------------------------------
create table service_models (
  tier                  client_tier primary key,
  meeting_interval_days int not null check (meeting_interval_days between 1 and 1095),
  call_interval_days    int not null check (call_interval_days between 1 and 1095),
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- contact_events — the heart of the system. Every completed touch logs here.
-- 'admin' touches are recorded but never reset the service clock.
-- ---------------------------------------------------------------------------
create table contact_events (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients (id) on delete cascade,
  advisor          advisor_assignment not null check (advisor <> 'joint'),
  type             contact_type not null,
  event_date       date not null default current_date,
  duration_minutes int check (duration_minutes is null or duration_minutes between 0 and 1440),
  notes            text,
  created_at       timestamptz not null default now()
);

create index contact_events_client_idx on contact_events (client_id, type, event_date desc);
create index contact_events_date_idx   on contact_events (event_date desc);

-- ---------------------------------------------------------------------------
-- due_dates — computed, never set by hand. One row per client per touch type,
-- always derived from the latest qualifying contact event + the tier's rule.
-- ---------------------------------------------------------------------------
create table due_dates (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null references clients (id) on delete cascade,
  type                   touch_type not null,
  due_date               date not null,
  computed_from_event_id uuid references contact_events (id) on delete set null,
  updated_at             timestamptz not null default now(),
  unique (client_id, type)
);

create index due_dates_due_idx on due_dates (due_date);

-- ---------------------------------------------------------------------------
-- tasks — system-generated queue items, rebuilt nightly (and on every write
-- that affects a client). At most one open task per client per touch type.
-- ---------------------------------------------------------------------------
create table tasks (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients (id) on delete cascade,
  type         touch_type not null,
  due_date     date not null,
  days_overdue int not null default 0,
  priority     task_priority not null default 'low',
  status       task_status not null default 'open',
  created_at   timestamptz not null default now()
);

create unique index tasks_one_open_per_touch on tasks (client_id, type) where status = 'open';
create index tasks_open_idx on tasks (status, due_date) where status = 'open';

-- ============================================================================
-- Service engine
-- ============================================================================

-- Tasks surface this many days before they are due.
create or replace function fn_task_horizon() returns int
language sql immutable as $$ select 14 $$;

create or replace function fn_task_priority(p_due date, p_today date) returns task_priority
language sql immutable as $$
  select case
    when p_due <  p_today then 'high'::task_priority    -- overdue items auto-escalate
    when p_due =  p_today then 'medium'::task_priority
    else                       'low'::task_priority
  end
$$;

-- Recompute a client's due dates from the latest meeting / meaningful call.
create or replace function fn_recompute_client_due_dates(p_client uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tier client_tier;
begin
  select tier into v_tier from clients where id = p_client;
  if v_tier is null then
    return;
  end if;

  with latest as (
    select distinct on (e.type)
      e.type::text::touch_type as ttype,
      e.event_date,
      e.id as event_id
    from contact_events e
    where e.client_id = p_client and e.type <> 'admin'
    order by e.type, e.event_date desc, e.created_at desc
  )
  insert into due_dates (client_id, type, due_date, computed_from_event_id, updated_at)
  select
    p_client,
    l.ttype,
    l.event_date + case l.ttype
      when 'meeting' then sm.meeting_interval_days
      else                sm.call_interval_days
    end,
    l.event_id,
    now()
  from latest l
  join service_models sm on sm.tier = v_tier
  on conflict (client_id, type) do update
    set due_date               = excluded.due_date,
        computed_from_event_id = excluded.computed_from_event_id,
        updated_at             = now();

  -- Drop due dates that no longer have a source event (e.g. event deleted).
  delete from due_dates d
  where d.client_id = p_client
    and not exists (
      select 1 from contact_events e
      where e.client_id = p_client
        and e.type <> 'admin'
        and e.type::text = d.type::text
    );
end $$;

-- Rebuild one client's open tasks from its due dates.
create or replace function fn_rebuild_client_tasks(p_client uuid, p_today date default current_date) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from tasks where client_id = p_client and status = 'open';

  insert into tasks (client_id, type, due_date, days_overdue, priority)
  select d.client_id, d.type, d.due_date,
         greatest(0, p_today - d.due_date),
         fn_task_priority(d.due_date, p_today)
  from due_dates d
  join clients c on c.id = d.client_id
  where d.client_id = p_client
    and c.active
    and d.due_date <= p_today + fn_task_horizon();
end $$;

-- Rebuild the whole firm's queue. Scheduled nightly at 6am; also callable
-- from the app ("refresh queue") and the rebuild-tasks edge function.
create or replace function rebuild_tasks(p_today date default current_date) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from tasks where status = 'open';

  insert into tasks (client_id, type, due_date, days_overdue, priority)
  select d.client_id, d.type, d.due_date,
         greatest(0, p_today - d.due_date),
         fn_task_priority(d.due_date, p_today)
  from due_dates d
  join clients c on c.id = d.client_id
  where c.active
    and d.due_date <= p_today + fn_task_horizon();
end $$;

-- Recompute everything (used after service model edits).
create or replace function recompute_all(p_today date default current_date) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in select id from clients loop
    perform fn_recompute_client_due_dates(r.id);
  end loop;
  perform rebuild_tasks(p_today);
end $$;

-- ---------------------------------------------------------------------------
-- Triggers that keep the engine self-consistent
-- ---------------------------------------------------------------------------

-- Any change to contact events: recompute due dates, settle tasks, rebuild.
create or replace function trg_contact_events_recompute() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform fn_recompute_client_due_dates(old.client_id);
    perform fn_rebuild_client_tasks(old.client_id);
    return old;
  end if;

  if tg_op = 'INSERT' and new.type <> 'admin' then
    -- A completed touch settles the matching open task.
    update tasks
      set status = 'done'
      where client_id = new.client_id
        and status = 'open'
        and type::text = new.type::text;
  end if;

  perform fn_recompute_client_due_dates(new.client_id);
  perform fn_rebuild_client_tasks(new.client_id);

  if tg_op = 'UPDATE' and old.client_id <> new.client_id then
    perform fn_recompute_client_due_dates(old.client_id);
    perform fn_rebuild_client_tasks(old.client_id);
  end if;

  return new;
end $$;

create trigger contact_events_recompute
  after insert or update or delete on contact_events
  for each row execute function trg_contact_events_recompute();

-- Tier or active flag changed: that client's cadence (and queue) changes.
create or replace function trg_clients_recompute() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.tier is distinct from new.tier then
    perform fn_recompute_client_due_dates(new.id);
  end if;
  perform fn_rebuild_client_tasks(new.id);
  return new;
end $$;

create trigger clients_recompute
  after update of tier, active on clients
  for each row execute function trg_clients_recompute();

-- Service model edited: the whole book reflows.
-- (Statement-level trigger: NEW/OLD are not assigned here — return null.)
create or replace function trg_service_models_recompute() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform recompute_all();
  return null;
end $$;

create trigger service_models_recompute
  after update on service_models
  for each statement execute function trg_service_models_recompute();

-- updated_at maintenance
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger clients_touch        before update on clients        for each row execute function set_updated_at();
create trigger service_models_touch before update on service_models for each row execute function set_updated_at();

-- Link a Supabase Auth signup to its firm profile by email.
create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.users
    set auth_user_id = new.id
    where lower(trim(email)) = lower(trim(new.email))
      and auth_user_id is null;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ...and the reverse direction: when an email is put on the team list,
-- normalize it (no stray spaces or capitals) and link an existing signup.
-- Step 3 of the README then works in either order.
create or replace function handle_users_email_set() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if new.email is not null then
    new.email := lower(trim(new.email));
    if new.auth_user_id is null then
      select u.id into new.auth_user_id
      from auth.users u
      where lower(trim(u.email)) = new.email
      limit 1;
    end if;
  end if;
  return new;
end $$;

create trigger users_email_link
  before insert or update of email on users
  for each row execute function handle_users_email_set();

-- ============================================================================
-- Row level security
-- ----------------------------------------------------------------------------
-- Phase 1 posture: this is an internal tool for three trusted people, and the
-- Firm Report needs every signed-in user to read firm-wide data. So: any
-- authenticated user can read and write; anonymous users get nothing.
-- Per-advisor scoping is a view default in the app, not a security boundary.
-- Tighten these policies if the firm ever grows past the founding team.
-- ============================================================================
alter table users          enable row level security;
alter table clients        enable row level security;
alter table service_models enable row level security;
alter table contact_events enable row level security;
alter table due_dates      enable row level security;
alter table tasks          enable row level security;

create policy "authenticated read users"   on users          for select to authenticated using (true);
create policy "authenticated update users" on users          for update to authenticated using (true) with check (true);
create policy "authenticated all clients"  on clients        for all    to authenticated using (true) with check (true);
create policy "authenticated all models"   on service_models for all    to authenticated using (true) with check (true);
create policy "authenticated all events"   on contact_events for all    to authenticated using (true) with check (true);
create policy "authenticated read due"     on due_dates      for select to authenticated using (true);
create policy "authenticated read tasks"   on tasks          for select to authenticated using (true);

-- ============================================================================
-- Realtime — broadcast row changes so every signed-in teammate's screen
-- converges live. (Guarded: the publication only exists on Supabase.)
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime
      add table clients, contact_events, due_dates, tasks, service_models, users;
  end if;
end $$;

-- ============================================================================
-- Seed data — the rules and the people. No demo clients here: a real backend
-- starts clean and Phase 1 clients are entered by hand in the app.
-- ============================================================================
insert into service_models (tier, meeting_interval_days, call_interval_days) values
  ('A',  90,  30),   -- quarterly meeting, monthly call   (~16 touches/yr)
  ('B', 365,  90),   -- annual meeting, quarterly call    (~5 touches/yr)
  ('C', 365, 180);   -- annual meeting, semiannual call   (~3 touches/yr)

-- Set real emails before inviting people, so signups auto-link to profiles:
--   update users set email = 'matt@yourfirm.com' where advisor_key = 'matt';
insert into users (name, email, role, advisor_key) values
  ('Matt',      null, 'advisor',   'matt'),
  ('Advisor B', null, 'advisor',   'advisor_b'),
  ('Assistant', null, 'assistant', null);

-- ============================================================================
-- Nightly rebuild at 6:00 — pick ONE of the two options:
--
-- Option A (recommended): pg_cron, entirely inside the database.
--   1. Dashboard → Database → Extensions → enable "pg_cron".
--   2. Run (cron runs in UTC — shift the hour for your timezone, e.g. 11 for 6am CT):
--        select cron.schedule('rebuild-tasks-daily', '0 11 * * *', $$select rebuild_tasks()$$);
--
-- Option B: the supabase/functions/rebuild-tasks edge function, scheduled
--   from Dashboard → Edge Functions → Schedules (cron: 0 11 * * *).
-- ============================================================================
