-- ============================================================================
-- Relationship Hub — upgrade: per-advisor privacy (row-level security).
-- Run on a database already on 0001–0004. Idempotent and single-step.
--
-- After this: the senior advisor (sees_all_books = true) and the assistant
-- see every client; other advisors see only their own book + joint; prospects
-- are private to each advisor (assistant sees all). Beau literally cannot read
-- or change Matt's clients via the API.
-- ============================================================================

-- Who-sees-all flag, and the defaults (senior advisor + assistant see all).
alter table users add column if not exists sees_all_books boolean not null default false;
update users set sees_all_books = true where role = 'assistant' and sees_all_books = false;
update users set sees_all_books = true where advisor_key = 'matt'  and sees_all_books = false;
-- ^ Change 'matt' above if your senior advisor is set up under a different key.

-- Requester identity helpers (security definer so policies can read users).
create or replace function app_sees_all() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select sees_all_books or role = 'assistant' from users where auth_user_id = auth.uid() limit 1),
    false)
$$;
create or replace function app_is_assistant() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'assistant' from users where auth_user_id = auth.uid() limit 1), false)
$$;
create or replace function app_advisor_key() returns advisor_assignment
language sql stable security definer set search_path = public as $$
  select advisor_key from users where auth_user_id = auth.uid() limit 1
$$;
grant execute on function app_sees_all(), app_is_assistant(), app_advisor_key() to authenticated;

-- Replace the old "everyone sees everything" policies with scoped ones.
alter table clients        enable row level security;
alter table contact_events enable row level security;
alter table due_dates      enable row level security;
alter table tasks          enable row level security;
alter table prospects        enable row level security;
alter table prospect_events  enable row level security;

drop policy if exists "authenticated all clients" on clients;
drop policy if exists "scoped clients" on clients;
create policy "scoped clients" on clients for all to authenticated
  using (app_sees_all() or assigned_advisor = app_advisor_key() or assigned_advisor = 'joint')
  with check (app_sees_all() or assigned_advisor = app_advisor_key() or assigned_advisor = 'joint');

drop policy if exists "authenticated all events" on contact_events;
drop policy if exists "scoped events" on contact_events;
create policy "scoped events" on contact_events for all to authenticated
  using (exists (select 1 from clients c where c.id = client_id
                 and (app_sees_all() or c.assigned_advisor = app_advisor_key() or c.assigned_advisor = 'joint')))
  with check (exists (select 1 from clients c where c.id = client_id
                 and (app_sees_all() or c.assigned_advisor = app_advisor_key() or c.assigned_advisor = 'joint')));

drop policy if exists "authenticated read due" on due_dates;
drop policy if exists "scoped due" on due_dates;
create policy "scoped due" on due_dates for select to authenticated
  using (exists (select 1 from clients c where c.id = client_id
                 and (app_sees_all() or c.assigned_advisor = app_advisor_key() or c.assigned_advisor = 'joint')));

drop policy if exists "authenticated read tasks" on tasks;
drop policy if exists "scoped tasks" on tasks;
create policy "scoped tasks" on tasks for select to authenticated
  using (exists (select 1 from clients c where c.id = client_id
                 and (app_sees_all() or c.assigned_advisor = app_advisor_key() or c.assigned_advisor = 'joint')));

drop policy if exists "authenticated all prospects" on prospects;
drop policy if exists "scoped prospects" on prospects;
create policy "scoped prospects" on prospects for all to authenticated
  using (app_is_assistant() or assigned_advisor = app_advisor_key() or assigned_advisor = 'joint')
  with check (app_is_assistant() or assigned_advisor = app_advisor_key() or assigned_advisor = 'joint');

drop policy if exists "authenticated all prospect events" on prospect_events;
drop policy if exists "scoped prospect events" on prospect_events;
create policy "scoped prospect events" on prospect_events for all to authenticated
  using (exists (select 1 from prospects p where p.id = prospect_id
                 and (app_is_assistant() or p.assigned_advisor = app_advisor_key() or p.assigned_advisor = 'joint')))
  with check (exists (select 1 from prospects p where p.id = prospect_id
                 and (app_is_assistant() or p.assigned_advisor = app_advisor_key() or p.assigned_advisor = 'joint')));

notify pgrst, 'reload schema';
