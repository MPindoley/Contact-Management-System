#!/usr/bin/env bash
# Validates the Relationship Hub migration + service engine against a real
# PostgreSQL (Supabase auth schema stubbed). Run from anywhere:
#   ./supabase/tests/engine_test.sh   (needs a local postgres service)
set -euo pipefail

cd "$(dirname "$0")/../.."
DB=rh_test
sudo -u postgres psql -qc "drop database if exists $DB;"
sudo -u postgres psql -qc "create database $DB;"

run() { sudo -u postgres psql -v ON_ERROR_STOP=1 -qd "$DB" "$@"; }

# --- Supabase environment stub -------------------------------------------
run <<'SQL'
create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
do $$ begin if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$;
SQL

# --- The migration under test --------------------------------------------
run -f "$(pwd)/supabase/migrations/0001_init.sql"

# --- Engine exercises ------------------------------------------------------
run <<'SQL'
\set ON_ERROR_STOP on

-- A Tier A client with a meeting 90 days ago (due today) and a call 42
-- days ago (12 days overdue).
insert into clients (id, household_name, assigned_advisor, tier)
  values ('11111111-1111-1111-1111-111111111111', 'Test Household A', 'matt', 'A');

insert into contact_events (client_id, advisor, type, event_date)
  values ('11111111-1111-1111-1111-111111111111', 'matt', 'meeting', current_date - 90);
insert into contact_events (client_id, advisor, type, event_date)
  values ('11111111-1111-1111-1111-111111111111', 'matt', 'call', current_date - 42);

do $$
declare d record; t record;
begin
  select * into strict d from due_dates
    where client_id = '11111111-1111-1111-1111-111111111111' and type = 'meeting';
  assert d.due_date = current_date, 'meeting due today, got ' || d.due_date;

  select * into strict d from due_dates
    where client_id = '11111111-1111-1111-1111-111111111111' and type = 'call';
  assert d.due_date = current_date - 12, 'call due 12d ago, got ' || d.due_date;

  select * into strict t from tasks
    where client_id = '11111111-1111-1111-1111-111111111111' and type = 'meeting' and status = 'open';
  assert t.priority = 'medium' and t.days_overdue = 0, 'meeting task medium/0';

  select * into strict t from tasks
    where client_id = '11111111-1111-1111-1111-111111111111' and type = 'call' and status = 'open';
  assert t.priority = 'high' and t.days_overdue = 12, 'call task high/12';
end $$;

-- Logging today's call settles the open task and rolls the clock +30.
insert into contact_events (client_id, advisor, type, event_date)
  values ('11111111-1111-1111-1111-111111111111', 'matt', 'call', current_date);

do $$
declare d record; n int;
begin
  select * into strict d from due_dates
    where client_id = '11111111-1111-1111-1111-111111111111' and type = 'call';
  assert d.due_date = current_date + 30, 'call due +30, got ' || d.due_date;

  select count(*) into n from tasks
    where client_id = '11111111-1111-1111-1111-111111111111' and type = 'call' and status = 'open';
  assert n = 0, 'no open call task (beyond horizon)';

  select count(*) into n from tasks
    where client_id = '11111111-1111-1111-1111-111111111111' and type = 'call' and status = 'done';
  assert n = 1, 'settled call task kept as history';
end $$;

-- Admin touches never move the clock.
insert into contact_events (client_id, advisor, type, event_date)
  values ('11111111-1111-1111-1111-111111111111', 'matt', 'admin', current_date);

do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = '11111111-1111-1111-1111-111111111111' and type = 'call';
  assert d.due_date = current_date + 30, 'admin must not move call due date';
end $$;

-- Tier change reflows from the same history (A meeting 90d → B meeting 365d).
update clients set tier = 'B' where id = '11111111-1111-1111-1111-111111111111';

do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = '11111111-1111-1111-1111-111111111111' and type = 'meeting';
  assert d.due_date = current_date - 90 + 365, 'tier change reflows meeting due';
end $$;

-- Service model edit reflows the whole book (statement-level trigger).
update service_models set call_interval_days = 45 where tier = 'B';

do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = '11111111-1111-1111-1111-111111111111' and type = 'call';
  assert d.due_date = current_date + 45, 'model edit reflows call due, got ' || d.due_date;
end $$;

-- Backdated entries older than the latest never regress the clock.
insert into contact_events (client_id, advisor, type, event_date)
  values ('11111111-1111-1111-1111-111111111111', 'matt', 'call', current_date - 200);

do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = '11111111-1111-1111-1111-111111111111' and type = 'call';
  assert d.due_date = current_date + 45, 'backdated insert must not regress';
end $$;

-- Deleting the latest event recomputes from what remains.
delete from contact_events
  where client_id = '11111111-1111-1111-1111-111111111111'
    and type = 'call' and event_date = current_date;

do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = '11111111-1111-1111-1111-111111111111' and type = 'call';
  assert d.due_date = current_date - 42 + 45, 'delete falls back to prior latest, got ' || d.due_date;
end $$;

-- Snooze suppresses a touch from the queue until the date passes.
insert into clients (id, household_name, assigned_advisor, tier)
  values ('44444444-4444-4444-4444-444444444444', 'Snooze Household', 'matt', 'A');
insert into contact_events (client_id, advisor, type, event_date)
  values ('44444444-4444-4444-4444-444444444444', 'matt', 'call', current_date - 40);

do $$
declare n int;
begin
  select count(*) into n from tasks
    where client_id = '44444444-4444-4444-4444-444444444444' and status = 'open';
  assert n = 1, 'overdue call task present before snooze';
end $$;

select snooze_touch('44444444-4444-4444-4444-444444444444', 'call', current_date + 5);

do $$
declare n int;
begin
  select count(*) into n from tasks
    where client_id = '44444444-4444-4444-4444-444444444444' and status = 'open';
  assert n = 0, 'snoozed task suppressed from the queue';
end $$;

-- It returns once the snooze lapses (simulated via a future rebuild).
select rebuild_tasks(current_date + 5);

do $$
declare n int;
begin
  select count(*) into n from tasks
    where client_id = '44444444-4444-4444-4444-444444444444' and status = 'open';
  assert n = 1, 'snoozed task returns after the snooze date';
end $$;

-- Logging a real contact clears any snooze.
update due_dates set snoozed_until = current_date + 30
  where client_id = '44444444-4444-4444-4444-444444444444' and type = 'call';
insert into contact_events (client_id, advisor, type, event_date)
  values ('44444444-4444-4444-4444-444444444444', 'matt', 'call', current_date);

do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = '44444444-4444-4444-4444-444444444444' and type = 'call';
  assert d.snoozed_until is null, 'fresh contact clears the snooze';
end $$;

-- Editing a contact's date reflows the due date (fix a mis-logged touch).
update contact_events set event_date = current_date - 10
  where client_id = '44444444-4444-4444-4444-444444444444'
    and type = 'call' and event_date = current_date;

do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = '44444444-4444-4444-4444-444444444444' and type = 'call';
  assert d.due_date = current_date - 10 + 30, 'edited contact reflows due date, got ' || d.due_date;
end $$;

-- Initial outreach: a never-contacted client gets a first-touch placeholder
-- that survives recomputes and converts to real cadence on first contact.
insert into clients (id, household_name, assigned_advisor, tier)
  values ('55555555-5555-5555-5555-555555555555', 'Never Contacted', 'matt', 'A');

select plan_outreach(
  ('[{"client_id":"55555555-5555-5555-5555-555555555555","due_date":"' || current_date || '"}]')::jsonb
);

do $$
declare d record; n int;
begin
  select * into strict d from due_dates
    where client_id = '55555555-5555-5555-5555-555555555555' and type = 'call';
  assert d.computed_from_event_id is null, 'outreach placeholder has no source event';
  select count(*) into n from tasks
    where client_id = '55555555-5555-5555-5555-555555555555' and status = 'open';
  assert n = 1, 'outreach placeholder produced a task';
end $$;

-- A service-model edit (recompute_all) must NOT wipe the placeholder.
update service_models set call_interval_days = call_interval_days where tier = 'A';

do $$
declare n int;
begin
  select count(*) into n from due_dates
    where client_id = '55555555-5555-5555-5555-555555555555' and computed_from_event_id is null;
  assert n = 1, 'outreach placeholder survives recompute_all';
end $$;

-- Logging the first real call converts it to the true cadence.
insert into contact_events (client_id, advisor, type, event_date)
  values ('55555555-5555-5555-5555-555555555555', 'matt', 'call', current_date);

do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = '55555555-5555-5555-5555-555555555555' and type = 'call';
  assert d.computed_from_event_id is not null, 'placeholder became a computed due date';
  assert d.due_date = current_date + 30, 'first contact starts the real Tier A call clock';
end $$;

-- Deactivation clears open tasks; rebuild_tasks() is idempotent.
update clients set active = false where id = '11111111-1111-1111-1111-111111111111';

do $$
declare n int;
begin
  select count(*) into n from tasks
    where client_id = '11111111-1111-1111-1111-111111111111' and status = 'open';
  assert n = 0, 'inactive client has no open tasks';
end $$;

select rebuild_tasks();
select rebuild_tasks();

-- Auth linking: a signup with a seeded email attaches to the profile.
update users set email = 'matt@test.firm' where advisor_key = 'matt';
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'MATT@TEST.FIRM');

do $$
declare u record;
begin
  select * into strict u from users where advisor_key = 'matt';
  assert u.auth_user_id = '22222222-2222-2222-2222-222222222222', 'auth user linked by email';
end $$;

-- Reverse order: the signup exists first and the email is set afterwards,
-- with messy casing and stray whitespace — normalized and linked anyway.
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'b@test.firm');
update users set email = '  B@Test.Firm ' where advisor_key = 'advisor_b';

do $$
declare u record;
begin
  select * into strict u from users where advisor_key = 'advisor_b';
  assert u.email = 'b@test.firm', 'email normalized, got [' || coalesce(u.email, '<null>') || ']';
  assert u.auth_user_id = '33333333-3333-3333-3333-333333333333', 'linked when email set after signup';
end $$;

-- Voicemail is tracked but never moves the service clock or settles a task.
insert into clients (id, household_name, assigned_advisor, tier)
  values ('66666666-6666-6666-6666-666666666666', 'Voicemail Household', 'matt', 'A');
insert into contact_events (client_id, advisor, type, event_date)
  values ('66666666-6666-6666-6666-666666666666', 'matt', 'call', current_date - 35);

do $$
declare d record; n int;
begin
  select * into strict d from due_dates
    where client_id = '66666666-6666-6666-6666-666666666666' and type = 'call';
  assert d.due_date = current_date - 5, 'call due 5d ago before voicemail, got ' || d.due_date;
  select count(*) into n from tasks
    where client_id = '66666666-6666-6666-6666-666666666666' and type = 'call' and status = 'open';
  assert n = 1, 'overdue call task present';
end $$;

insert into contact_events (client_id, advisor, type, event_date)
  values ('66666666-6666-6666-6666-666666666666', 'matt', 'voicemail', current_date);

do $$
declare d record; n int;
begin
  select * into strict d from due_dates
    where client_id = '66666666-6666-6666-6666-666666666666' and type = 'call';
  assert d.due_date = current_date - 5, 'voicemail must NOT move the call clock, got ' || d.due_date;
  select count(*) into n from tasks
    where client_id = '66666666-6666-6666-6666-666666666666' and type = 'call' and status = 'open';
  assert n = 1, 'voicemail must NOT settle the call task';
end $$;

-- Deleting a client erases its contact events, due dates, and tasks (cascade).
insert into clients (id, household_name, assigned_advisor, tier)
  values ('88888888-8888-8888-8888-888888888888', 'Delete Me Household', 'matt', 'A');
insert into contact_events (client_id, advisor, type, event_date)
  values ('88888888-8888-8888-8888-888888888888', 'matt', 'call', current_date - 40);

do $$
declare n int;
begin
  select count(*) into n from due_dates where client_id = '88888888-8888-8888-8888-888888888888';
  assert n >= 1, 'client has a due date before delete';
end $$;

delete from clients where id = '88888888-8888-8888-8888-888888888888';

do $$
declare n int;
begin
  select count(*) into n from contact_events where client_id = '88888888-8888-8888-8888-888888888888';
  assert n = 0, 'contact events cascade-deleted';
  select count(*) into n from due_dates where client_id = '88888888-8888-8888-8888-888888888888';
  assert n = 0, 'due dates cascade-deleted';
  select count(*) into n from tasks where client_id = '88888888-8888-8888-8888-888888888888';
  assert n = 0, 'tasks cascade-deleted';
end $$;

-- Prospects island: completely independent of the client engine.
insert into prospects (id, name, assigned_advisor, phone, status)
  values ('77777777-7777-7777-7777-777777777777', 'Test Prospect', 'matt', '(419) 555-0000', 'new');
insert into prospect_events (prospect_id, advisor, type, event_date, notes)
  values ('77777777-7777-7777-7777-777777777777', 'matt', 'voicemail', current_date, 'Left a message.');

do $$
declare n int;
begin
  select count(*) into n from prospect_events where prospect_id = '77777777-7777-7777-7777-777777777777';
  assert n = 1, 'prospect event recorded';
  -- A prospect must never create a client, due date, or task.
  select count(*) into n from due_dates d join prospects p on p.id::text = d.client_id::text;
  assert n = 0, 'prospects never leak into due_dates';
end $$;

-- --------------------------------------------------------------------------
-- One conversation, several households: a joint review is logged as one row
-- per household so each clock rolls forward by its OWN tier, and the rows
-- share a group_id so the conversation can still be counted once.
-- --------------------------------------------------------------------------
insert into families (id, name)
  values ('99999999-9999-9999-9999-000000000001', 'Harness Family');
insert into clients (id, household_name, assigned_advisor, tier, family_id) values
  ('99999999-9999-9999-9999-000000000010', 'Harness, Head',  'matt', 'S',
   '99999999-9999-9999-9999-000000000001'),
  ('99999999-9999-9999-9999-000000000011', 'Harness, Child', 'matt', 'C',
   '99999999-9999-9999-9999-000000000001');

insert into contact_events (client_id, advisor, type, event_date, group_id) values
  ('99999999-9999-9999-9999-000000000010', 'matt', 'meeting', current_date,
   'aaaa0000-0000-0000-0000-00000000000f'),
  ('99999999-9999-9999-9999-000000000011', 'matt', 'meeting', current_date,
   'aaaa0000-0000-0000-0000-00000000000f');

do $$
declare head_due date; child_due date; s_int int; c_int int; n int;
begin
  select meeting_interval_days into strict s_int from service_models where tier = 'S';
  select meeting_interval_days into strict c_int from service_models where tier = 'C';
  assert s_int <> c_int, 'fixture must use two different cadences';

  select due_date into strict head_due from due_dates
    where client_id = '99999999-9999-9999-9999-000000000010' and type = 'meeting';
  select due_date into strict child_due from due_dates
    where client_id = '99999999-9999-9999-9999-000000000011' and type = 'meeting';
  assert head_due = current_date + s_int, 'head rolls by its own tier, got ' || head_due;
  assert child_due = current_date + c_int, 'child rolls by its own tier, got ' || child_due;

  -- Neither household is left with an open meeting task.
  select count(*) into n from tasks
    where client_id in ('99999999-9999-9999-9999-000000000010',
                        '99999999-9999-9999-9999-000000000011')
      and type = 'meeting' and status = 'open';
  assert n = 0, 'both households settled, got ' || n;

  -- Two rows, one conversation.
  select count(distinct coalesce(group_id, id)) into n from contact_events
    where client_id in ('99999999-9999-9999-9999-000000000010',
                        '99999999-9999-9999-9999-000000000011');
  assert n = 1, 'one conversation across the family, got ' || n;
end $$;

-- --------------------------------------------------------------------------
-- fn_prune_empty_families counts members across EVERY book. The old
-- client-side version counted them through the caller's own row-level
-- security scope, so a family whose remaining members sat in another
-- advisor's book looked empty and was deleted -- silently unlinking those
-- households, because family_id is `on delete set null`.
-- --------------------------------------------------------------------------
insert into families (id, name)
  values ('99999999-9999-9999-9999-000000000002', 'Only Beau Left');
insert into clients (id, household_name, assigned_advisor, tier, family_id)
  values ('99999999-9999-9999-9999-000000000020', 'Beau Household', 'advisor_b', 'B',
          '99999999-9999-9999-9999-000000000002');
insert into families (id, name)
  values ('99999999-9999-9999-9999-000000000003', 'Genuinely Empty');

select fn_prune_empty_families();

do $$
declare n int;
begin
  select count(*) into n from families where id = '99999999-9999-9999-9999-000000000002';
  assert n = 1, 'a family with a member in another book survives';
  select count(*) into n from clients
    where id = '99999999-9999-9999-9999-000000000020'
      and family_id = '99999999-9999-9999-9999-000000000002';
  assert n = 1, 'and its member keeps the link';

  select count(*) into n from families where id = '99999999-9999-9999-9999-000000000003';
  assert n = 0, 'a family with no members anywhere is deleted';
end $$;

-- --------------------------------------------------------------------------
-- mirror_touches: a standing rule per member, defaulting to on so every
-- household that existed before the column behaves exactly as it did.
-- The engine never reads it -- the app decides who a touch is written for --
-- so the only contract here is the column and its default.
-- --------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from clients where mirror_touches is null;
  assert n = 0, 'mirror_touches is never null, got ' || n;

  select count(*) into n from clients where not mirror_touches;
  assert n = 0, 'every existing household mirrors by default, got ' || n;
end $$;

insert into clients (id, household_name, assigned_advisor, tier, mirror_touches)
  values ('99999999-9999-9999-9999-000000000030', 'Opted Out', 'matt', 'C', false);

do $$
declare m boolean;
begin
  select mirror_touches into strict m from clients
    where id = '99999999-9999-9999-9999-000000000030';
  assert m = false, 'the rule can be turned off';

  -- Turning it off must not touch the service engine: the household still
  -- gets its own due dates from its own touches.
  insert into contact_events (client_id, advisor, type, event_date)
    values ('99999999-9999-9999-9999-000000000030', 'matt', 'call', current_date);
  perform 1 from due_dates
    where client_id = '99999999-9999-9999-9999-000000000030' and type = 'call';
  assert found, 'a non-mirroring household still runs its own clock';
end $$;

-- --------------------------------------------------------------------------
-- client_tags: the firm's own opportunity tags. Config, not code. The ids are
-- what clients.tags already stores, so seeding must not disturb a household.
-- --------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from client_tags;
  assert n >= 11, 'the built-in tags are seeded, got ' || n;

  -- The ids households already carry must exist.
  foreach n in array array[1] loop null; end loop;  -- (no-op, keeps plpgsql happy)
  perform 1 from client_tags where id = 'roth_conversion';
  assert found, 'roth_conversion survives';
  perform 1 from client_tags where id = 'roth_ira';
  assert found, 'roth_ira is seeded -- the tag this change was asked for';

  -- Keywords drive the note suggester and are matched lower-case.
  select count(*) into n from client_tags where exists (
    select 1 from unnest(keywords) k where k <> lower(k)
  );
  assert n = 0, 'every seeded keyword is lower-case, got ' || n || ' that are not';

  -- Roth Conversion must NOT own a bare "roth": that belongs to Roth IRA, and
  -- the app's specificity rule relies on the longer phrase being the only one.
  select count(*) into n from client_tags
    where id = 'roth_conversion' and 'roth' = any (keywords);
  assert n = 0, 'roth_conversion does not claim a bare "roth"';
end $$;

-- A tag a firm adds itself behaves like any other: no enum, no code change.
insert into client_tags (id, label, keywords, sort_order)
  values ('hsa_funding', 'HSA Funding', array['hsa','health savings'], 99);

insert into clients (id, household_name, assigned_advisor, tier, tags)
  values ('99999999-9999-9999-9999-000000000040', 'Tagged Household', 'matt', 'B',
          array['hsa_funding','roth_ira']);

do $$
declare n int;
begin
  select count(*) into n from clients
    where id = '99999999-9999-9999-9999-000000000040' and 'hsa_funding' = any (tags);
  assert n = 1, 'a household carries a firm-created tag';

  -- clients.tags has no foreign key on purpose: deleting a definition must
  -- never be blocked by, or cascade into, client rows.
  delete from client_tags where id = 'hsa_funding';
  select count(*) into n from clients
    where id = '99999999-9999-9999-9999-000000000040' and 'hsa_funding' = any (tags);
  assert n = 1, 'deleting the definition does not touch the household row';
end $$;

-- --------------------------------------------------------------------------
-- Meetings cover the calls (0013). Two meetings on different days within a
-- year meet the call requirement: the call isn't due until the older of the
-- two is a year old. Mirrors src/engine/meetingsCoverCalls.test.ts.
-- --------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from service_models where meetings_cover_calls = 2;
  assert n = 4, 'on for S, A, B and C out of the box, got ' || n;
end $$;

-- (An earlier case moved B's calls to 45 days; put the default back.)
update service_models set call_interval_days = 90 where tier = 'B';

-- B household: meetings 200 and 20 days ago, last call 100 days ago.
insert into clients (id, household_name, assigned_advisor, tier)
  values ('cccc0000-0000-0000-0000-000000000001', 'Covered B', 'matt', 'B');
insert into contact_events (id, client_id, advisor, type, event_date) values
  ('cccc0000-0000-0000-0000-0000000000a1', 'cccc0000-0000-0000-0000-000000000001', 'matt', 'meeting', current_date - 200),
  ('cccc0000-0000-0000-0000-0000000000a2', 'cccc0000-0000-0000-0000-000000000001', 'matt', 'meeting', current_date - 20),
  ('cccc0000-0000-0000-0000-0000000000a3', 'cccc0000-0000-0000-0000-000000000001', 'matt', 'call',    current_date - 100);

do $$
declare d record; n int;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000001' and type = 'call';
  assert d.due_date = current_date - 200 + 365, 'call waits for the older meeting to turn a year, got ' || d.due_date;
  assert d.computed_from_event_id = 'cccc0000-0000-0000-0000-0000000000a1', 'sourced from the older meeting';
  select count(*) into n from tasks
    where client_id = 'cccc0000-0000-0000-0000-000000000001' and type = 'call' and status = 'open';
  assert n = 0, 'a covered call is not on the queue';
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000001' and type = 'meeting';
  assert d.due_date = current_date - 20 + 365, 'the meeting clock is untouched, got ' || d.due_date;
end $$;

-- Turning the rule off for B brings the call straight back.
update service_models set meetings_cover_calls = null where tier = 'B';
do $$
declare d record; n int;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000001' and type = 'call';
  assert d.due_date = current_date - 10, 'off: last call + 90, got ' || d.due_date;
  assert d.computed_from_event_id = 'cccc0000-0000-0000-0000-0000000000a3', 'off: sourced from the call';
  select count(*) into n from tasks
    where client_id = 'cccc0000-0000-0000-0000-000000000001' and type = 'call' and status = 'open';
  assert n = 1, 'off: the overdue call is back on the queue';
end $$;

-- Three meetings needed: two isn't enough.
update service_models set meetings_cover_calls = 3 where tier = 'B';
do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000001' and type = 'call';
  assert d.due_date = current_date - 10, 'three needed, two held: not covered, got ' || d.due_date;
end $$;
update service_models set meetings_cover_calls = 2 where tier = 'B';

-- Only 2..12 are accepted.
do $$
begin
  begin
    update service_models set meetings_cover_calls = 1 where tier = 'B';
    assert false, 'meetings_cover_calls = 1 must be rejected';
  exception when check_violation then null;
  end;
end $$;

-- Deleting one of the two meetings ends the cover.
delete from contact_events where id = 'cccc0000-0000-0000-0000-0000000000a1';
do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000001' and type = 'call';
  assert d.due_date = current_date - 10, 'one meeting left: back to the call cadence, got ' || d.due_date;
  assert d.computed_from_event_id = 'cccc0000-0000-0000-0000-0000000000a3', 'sourced from the call again';
end $$;

-- Two meetings on the SAME day are one meeting.
insert into clients (id, household_name, assigned_advisor, tier)
  values ('cccc0000-0000-0000-0000-000000000002', 'Same Day', 'matt', 'B');
insert into contact_events (client_id, advisor, type, event_date) values
  ('cccc0000-0000-0000-0000-000000000002', 'matt', 'meeting', current_date - 30),
  ('cccc0000-0000-0000-0000-000000000002', 'matt', 'meeting', current_date - 30),
  ('cccc0000-0000-0000-0000-000000000002', 'matt', 'call',    current_date - 100);
do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000002' and type = 'call';
  assert d.due_date = current_date - 10, 'a same-day double is one meeting, got ' || d.due_date;
end $$;

-- Meetings but never a call: the rule never invents a call row.
insert into clients (id, household_name, assigned_advisor, tier)
  values ('cccc0000-0000-0000-0000-000000000003', 'No Calls', 'matt', 'C');
insert into contact_events (client_id, advisor, type, event_date) values
  ('cccc0000-0000-0000-0000-000000000003', 'matt', 'meeting', current_date - 300),
  ('cccc0000-0000-0000-0000-000000000003', 'matt', 'meeting', current_date - 10);
do $$
declare n int;
begin
  select count(*) into n from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000003' and type = 'call';
  assert n = 0, 'no call ever logged means no call row, got ' || n;
end $$;

-- C applies too; a later call wins; a tie goes to the call.
insert into contact_events (id, client_id, advisor, type, event_date) values
  ('cccc0000-0000-0000-0000-0000000000c1', 'cccc0000-0000-0000-0000-000000000003', 'matt', 'call', current_date - 200);
do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000003' and type = 'call';
  assert d.due_date = current_date + 65, 'C covered until the older meeting turns a year, got ' || d.due_date;
end $$;
-- Call 300 days ago + 180 = +65: exactly the cover's end. Tie → the call.
update contact_events set event_date = current_date - 115 where id = 'cccc0000-0000-0000-0000-0000000000c1';
do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000003' and type = 'call';
  assert d.due_date = current_date + 65, 'tie keeps the date, got ' || d.due_date;
  assert d.computed_from_event_id = 'cccc0000-0000-0000-0000-0000000000c1', 'a tie goes to the call';
end $$;
update contact_events set event_date = current_date - 5 where id = 'cccc0000-0000-0000-0000-0000000000c1';
do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000003' and type = 'call';
  assert d.due_date = current_date + 175, 'a later call wins, got ' || d.due_date;
end $$;

-- A meeting dated after the day it was logged (an import typo) never counts;
-- an old meeting backfilled today does.
insert into clients (id, household_name, assigned_advisor, tier)
  values ('cccc0000-0000-0000-0000-000000000004', 'Typo', 'matt', 'B');
insert into contact_events (client_id, advisor, type, event_date) values
  ('cccc0000-0000-0000-0000-000000000004', 'matt', 'meeting', current_date - 40),
  ('cccc0000-0000-0000-0000-000000000004', 'matt', 'meeting', current_date + 300),
  ('cccc0000-0000-0000-0000-000000000004', 'matt', 'call',    current_date - 100);
do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000004' and type = 'call';
  assert d.due_date = current_date - 10, 'a future-dated meeting does not cover, got ' || d.due_date;
end $$;
insert into contact_events (client_id, advisor, type, event_date) values
  ('cccc0000-0000-0000-0000-000000000004', 'matt', 'meeting', current_date - 150);
do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000004' and type = 'call';
  assert d.due_date = current_date - 150 + 365, 'a backfilled meeting counts, got ' || d.due_date;
end $$;

-- The covering meetings must be within a year of each other. Tier A: met 600
-- and 500 days ago, last call 530 days ago, so the calls were covered until
-- 235 days ago and have been due since. Meeting them today must not rewrite
-- that to "due since 135 days ago": today and 500 days ago aren't a year apart.
insert into clients (id, household_name, assigned_advisor, tier)
  values ('cccc0000-0000-0000-0000-000000000006', 'Late Meeting', 'matt', 'A');
insert into contact_events (client_id, advisor, type, event_date) values
  ('cccc0000-0000-0000-0000-000000000006', 'matt', 'meeting', current_date - 600),
  ('cccc0000-0000-0000-0000-000000000006', 'matt', 'meeting', current_date - 500),
  ('cccc0000-0000-0000-0000-000000000006', 'matt', 'call',    current_date - 530);
do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000006' and type = 'call';
  assert d.due_date = current_date - 235, 'covered until the older meeting turned a year, got ' || d.due_date;
end $$;
insert into contact_events (client_id, advisor, type, event_date)
  values ('cccc0000-0000-0000-0000-000000000006', 'matt', 'meeting', current_date);
do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000006' and type = 'call';
  assert d.due_date = current_date - 235, 'a late meeting keeps when the call fell due, got ' || d.due_date;
end $$;
-- Exactly a year apart is a day too many; a day less covers for one day.
insert into clients (id, household_name, assigned_advisor, tier)
  values ('cccc0000-0000-0000-0000-000000000007', 'Year Apart', 'matt', 'B');
insert into contact_events (id, client_id, advisor, type, event_date) values
  ('cccc0000-0000-0000-0000-0000000000e1', 'cccc0000-0000-0000-0000-000000000007', 'matt', 'meeting', current_date - 400),
  ('cccc0000-0000-0000-0000-0000000000e2', 'cccc0000-0000-0000-0000-000000000007', 'matt', 'meeting', current_date - 35),
  ('cccc0000-0000-0000-0000-0000000000e3', 'cccc0000-0000-0000-0000-000000000007', 'matt', 'call',    current_date - 200);
do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000007' and type = 'call';
  assert d.computed_from_event_id = 'cccc0000-0000-0000-0000-0000000000e3', '365 days apart covers nothing';
end $$;
update contact_events set event_date = current_date - 399 where id = 'cccc0000-0000-0000-0000-0000000000e1';
do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000007' and type = 'call';
  assert d.computed_from_event_id = 'cccc0000-0000-0000-0000-0000000000e1', '364 days apart covers';
  assert d.due_date = current_date - 34, 'for exactly one day, got ' || d.due_date;
end $$;

-- Snoozes. A booked meeting survives logging a call (it used to be wiped).
insert into clients (id, household_name, assigned_advisor, tier)
  values ('cccc0000-0000-0000-0000-000000000005', 'Booked', 'matt', 'A');
insert into contact_events (client_id, advisor, type, event_date) values
  ('cccc0000-0000-0000-0000-000000000005', 'matt', 'meeting', current_date - 100),
  ('cccc0000-0000-0000-0000-000000000005', 'matt', 'call',    current_date - 40);
select snooze_touch('cccc0000-0000-0000-0000-000000000005', 'meeting', current_date + 20);
insert into contact_events (client_id, advisor, type, event_date)
  values ('cccc0000-0000-0000-0000-000000000005', 'matt', 'call', current_date);
do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000005' and type = 'meeting';
  assert d.snoozed_until = current_date + 20, 'logging a call keeps the booked meeting, got ' || coalesce(d.snoozed_until::text, 'null');
end $$;
-- A tier edit keeps it too.
update service_models set call_interval_days = call_interval_days where tier = 'A';
do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000005' and type = 'meeting';
  assert d.snoozed_until = current_date + 20, 'a tier edit keeps the booked meeting';
end $$;
-- A voicemail's "try again in a week" on the call. Then the meeting happens:
-- that clears the booking, and makes two meetings, so the calls are covered.
-- The call row now comes from a meeting, and its snooze comes along (it only
-- ever moved later). A fresh call after that keeps it too.
select snooze_touch('cccc0000-0000-0000-0000-000000000005', 'call', current_date + 7);
insert into contact_events (client_id, advisor, type, event_date)
  values ('cccc0000-0000-0000-0000-000000000005', 'matt', 'meeting', current_date);
do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000005' and type = 'call';
  assert d.snoozed_until = current_date + 7, 'a call moving onto its cover keeps its snooze';
end $$;
insert into contact_events (client_id, advisor, type, event_date)
  values ('cccc0000-0000-0000-0000-000000000005', 'matt', 'call', current_date);
do $$
declare d record;
begin
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000005' and type = 'meeting';
  assert d.snoozed_until is null, 'the meeting happening clears the booking';
  select * into strict d from due_dates
    where client_id = 'cccc0000-0000-0000-0000-000000000005' and type = 'call';
  assert d.due_date = current_date - 100 + 365, 'A covered until the older meeting turns a year, got ' || d.due_date;
  assert d.snoozed_until = current_date + 7, 'a covered call keeps its snooze';
end $$;

select 'ALL_SQL_ASSERTIONS_PASSED' as result;
SQL
