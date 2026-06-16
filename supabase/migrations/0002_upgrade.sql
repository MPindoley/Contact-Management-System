-- ============================================================================
-- Relationship Hub — upgrade 0001 → current. SAFE TO RE-RUN.
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor on a database that already has the
-- original schema. It is fully idempotent (add-if-not-exists, create-or-
-- replace, drop-then-create), so re-running it never errors. It brings an
-- existing install up to date with every feature added after first setup:
-- snooze, initial outreach, and client phone numbers.
--
-- Fresh installs don't need this — 0001_init.sql already includes everything.
-- ============================================================================

-- New columns ----------------------------------------------------------------
alter table clients   add column if not exists phone text;
alter table due_dates add column if not exists snoozed_until date;

-- Voicemail contact type (tracked, but never moves the service clock) ---------
alter type contact_type add value if not exists 'voicemail';

-- Prospects island: a separate area for not-yet-clients. No links to the
-- client tables, no engine triggers — it can't affect any client graph. ------
do $$ begin
  create type prospect_status as enum ('new', 'working', 'appointment', 'converted', 'lost');
exception when duplicate_object then null; end $$;
do $$ begin
  create type prospect_event_type as enum ('call', 'voicemail', 'meeting', 'email', 'note');
exception when duplicate_object then null; end $$;

create table if not exists prospects (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  assigned_advisor advisor_assignment not null default 'matt',
  phone            text,
  status           prospect_status not null default 'new',
  notes            text,
  next_follow_up   date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists prospect_events (
  id           uuid primary key default gen_random_uuid(),
  prospect_id  uuid not null references prospects (id) on delete cascade,
  advisor      advisor_assignment not null check (advisor <> 'joint'),
  type         prospect_event_type not null,
  event_date   date not null default current_date,
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists prospect_events_idx on prospect_events (prospect_id, event_date desc);

drop trigger if exists prospects_touch on prospects;
create trigger prospects_touch before update on prospects for each row execute function set_updated_at();

alter table prospects       enable row level security;
alter table prospect_events enable row level security;
drop policy if exists "authenticated all prospects" on prospects;
create policy "authenticated all prospects" on prospects for all to authenticated using (true) with check (true);
drop policy if exists "authenticated all prospect events" on prospect_events;
create policy "authenticated all prospect events" on prospect_events for all to authenticated using (true) with check (true);

-- Service engine: recompute now preserves first-outreach placeholders and
-- clears snooze on a fresh contact ------------------------------------------
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
    where e.client_id = p_client and e.type in ('meeting', 'call')
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
        snoozed_until          = null,
        updated_at             = now();

  delete from due_dates d
  where d.client_id = p_client
    and d.computed_from_event_id is not null
    and not exists (
      select 1 from contact_events e
      where e.client_id = p_client and e.type in ('meeting', 'call') and e.type::text = d.type::text
    );

  delete from due_dates d
  where d.client_id = p_client
    and d.computed_from_event_id is null
    and exists (
      select 1 from contact_events e
      where e.client_id = p_client and e.type in ('meeting', 'call')
    );
end $$;

-- Task rebuilds now exclude snoozed touches ---------------------------------
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
    and d.due_date <= p_today + fn_task_horizon()
    and (d.snoozed_until is null or d.snoozed_until <= p_today);
end $$;

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
    and d.due_date <= p_today + fn_task_horizon()
    and (d.snoozed_until is null or d.snoozed_until <= p_today);
end $$;

-- New RPCs: snooze and initial outreach -------------------------------------
create or replace function snooze_touch(p_client uuid, p_type touch_type, p_until date) returns void
language plpgsql security definer set search_path = public as $$
begin
  update due_dates set snoozed_until = p_until, updated_at = now()
    where client_id = p_client and type = p_type;
  perform fn_rebuild_client_tasks(p_client);
end $$;

create or replace function plan_outreach(p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into due_dates (client_id, type, due_date, computed_from_event_id)
  select (item->>'client_id')::uuid, 'call'::touch_type, (item->>'due_date')::date, null
  from jsonb_array_elements(p_items) as item
  on conflict (client_id, type) do nothing;
  perform rebuild_tasks();
end $$;

-- Let authenticated users self-heal the auth link (used by the app) ----------
drop policy if exists "authenticated update users" on users;
create policy "authenticated update users" on users for update to authenticated using (true) with check (true);

-- Make sure realtime broadcasts every table (idempotent add) -----------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['clients','contact_events','due_dates','tasks','service_models','users','prospects','prospect_events'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- Tell PostgREST (the API layer) to reload, so the new RPCs are callable
-- immediately instead of erroring with "not found in the schema cache".
notify pgrst, 'reload schema';

