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

select 'ALL_SQL_ASSERTIONS_PASSED' as result;
SQL
