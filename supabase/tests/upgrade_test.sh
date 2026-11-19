#!/usr/bin/env bash
# Upgrade-path checks. The engine and RLS harnesses both build a database from
# 0001 alone, which is the FRESH-install path — and that is exactly why the
# "permission denied for table client_tags" bug got through: 0001 creates the
# table before its `grant ... on all tables` line, so a fresh database is
# always fine. A database that ran 0001 months ago and picked up the table from
# a later migration is not.
#
# So this harness synthesises the real situation: a database from before the
# table existed, then the upgrade migrations on top, exercised as the
# `authenticated` role rather than as superuser. It does the same for 0013
# (meetings cover the calls): a database with history, bookings and snoozes
# from before the change, then 0013 on top, then 0013 again.
#
#   ./supabase/tests/upgrade_test.sh   (needs a local postgres service)
set -euo pipefail

cd "$(dirname "$0")/../.."
DB=rh_upgrade
sudo -u postgres psql -qc "drop database if exists $DB;"
sudo -u postgres psql -qc "create database $DB;"
run() { sudo -u postgres psql -v ON_ERROR_STOP=1 -qd "$DB" "$@"; }

# --- Supabase stub ----------------------------------------------------------
run <<'SQL'
create schema auth;
create table auth.users (id uuid primary key, email text);
do $$ begin if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
SQL

# --- A database as it was BEFORE client_tags existed ------------------------
# Strip the table (and everything that depends on it) out of 0001, so the
# blanket grant runs with the table absent — which is the live situation.
python3 - <<'PY'
import re, sys
s = open("supabase/migrations/0001_init.sql").read()
# Strip only whole statements, and the publication member. A blanket
# line-delete would gut the do$$ block the publication lives in.
before = s
s = re.sub(r"create table client_tags \(.*?\);\n", "-- (client_tags did not exist yet)\n", s, flags=re.S)
s = re.sub(r"insert into client_tags .*?;\n", "", s, flags=re.S)
s = re.sub(r"create trigger client_tags_touch[^;]*;\n", "", s)
s = re.sub(r"alter table client_tags\s+enable row level security;\n", "", s)
s = re.sub(r'create policy "authenticated all client tags"[^;]*;\n', "", s)
s = re.sub(r"grant [^;\n]*on client_tags[^;]*;\n", "", s)
s = s.replace(", client_tags;", ";")
# The live database also predates the default-privileges line 0012 adds, so
# strip that too or the table would inherit the grant and the bug would not
# reproduce.
s = re.sub(r"alter default privileges in schema public\n\s+grant[^;]*;\n", "", s)
if "client_tags" in re.sub(r"^\s*--.*$", "", s, flags=re.M):
    sys.exit("client_tags still referenced after stripping — update the harness")
open("/tmp/0001_before_client_tags.sql", "w").write(s)
PY
run -f /tmp/0001_before_client_tags.sql > /dev/null

# --- 0011 as it originally shipped: creates the table, no grant -------------
python3 - <<'PY'
s = open("supabase/migrations/0011_custom_tags.sql").read()
s = s.replace("grant select, insert, update, delete on client_tags to authenticated;", "")
open("/tmp/0011_without_grant.sql", "w").write(s)
PY
run -f /tmp/0011_without_grant.sql > /dev/null

# The bug: RLS is on and the policy says "true", but the role was never granted
# the table, so Postgres refuses before it ever looks at the policy.
BLOCKED=$(sudo -u postgres psql -qd "$DB" 2>&1 <<'SQL' | grep -c "permission denied for table client_tags" || true
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
insert into client_tags (id, label, keywords, sort_order) values ('probe','Probe',array['probe'],99);
SQL
)
if [ "$BLOCKED" -ne 1 ]; then
  echo "FAILED: expected the ungranted table to refuse an authenticated insert"
  exit 1
fi
echo "reproduced: ungranted client_tags refuses an authenticated insert"

# --- 0012 is the fix --------------------------------------------------------
run -f "$(pwd)/supabase/migrations/0012_client_tags_grants.sql" > /dev/null

run <<'SQL'
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
insert into client_tags (id, label, keywords, sort_order) values ('probe','Probe',array['probe'],99);
update client_tags set label = 'Probe Two' where id = 'probe';
delete from client_tags where id = 'probe';
reset role;
SQL
echo "0012 restores insert / update / delete for authenticated"

# --- The invariant, so the next table added cannot repeat this --------------
# Every table in public must be usable by `authenticated`; the policies decide
# which rows, but the grant has to exist first.
run <<'SQL'
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ') into missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and not (
      has_table_privilege('authenticated', c.oid, 'SELECT') and
      has_table_privilege('authenticated', c.oid, 'INSERT') and
      has_table_privilege('authenticated', c.oid, 'UPDATE') and
      has_table_privilege('authenticated', c.oid, 'DELETE')
    );
  assert missing is null, 'tables not granted to authenticated: ' || missing;
end $$;
SQL

# --- And that default privileges now cover a future table -------------------
run <<'SQL'
create table probe_future (id int primary key);
do $$
begin
  assert has_table_privilege('authenticated', 'probe_future', 'SELECT'),
    'a table created after 0012 inherits the grant automatically';
end $$;
drop table probe_future;
SQL
echo "default privileges cover tables added later"

# ============================================================================
# 0013: meetings cover the calls, on a live database.
# ----------------------------------------------------------------------------
# Synthesise a database as it was on 0012: today's schema with the column
# taken back out and the recompute function from 0002 (the one live databases
# run until 0013) put back. Then real-looking history, with snoozes and
# bookings set the way the app sets them, then 0013 on top.
# ============================================================================
DB=rh_upgrade_0013
sudo -u postgres psql -qc "drop database if exists $DB;"
sudo -u postgres psql -qc "create database $DB;"
run <<'SQL'
create schema auth;
create table auth.users (id uuid primary key, email text);
do $$ begin if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
SQL
run -f "$(pwd)/supabase/migrations/0001_init.sql" > /dev/null
python3 - <<'PY'
import re
s = open("supabase/migrations/0002_upgrade.sql").read()
m = re.search(r"create or replace function fn_recompute_client_due_dates.*?\nend \$\$;\n", s, re.S)
open("/tmp/fn_recompute_0002.sql", "w").write(m.group(0))
PY
run -c "alter table service_models drop column meetings_cover_calls;" > /dev/null
run -f /tmp/fn_recompute_0002.sql > /dev/null

run <<'SQL'
-- U1, B: two meetings this year and an overdue call. U2, A: one meeting and
-- the next one booked. U3, C: a voicemail's "try again" on its call. U4: a
-- first-outreach placeholder. U5, A: booked, then a call logged, which under
-- the old engine un-parks the booking. U6, A: a booking whose day has passed.
insert into clients (id, household_name, assigned_advisor, tier) values
  ('dddd0000-0000-0000-0000-000000000001', 'U1', 'matt', 'B'),
  ('dddd0000-0000-0000-0000-000000000002', 'U2', 'matt', 'A'),
  ('dddd0000-0000-0000-0000-000000000003', 'U3', 'matt', 'C'),
  ('dddd0000-0000-0000-0000-000000000004', 'U4', 'matt', 'B'),
  ('dddd0000-0000-0000-0000-000000000005', 'U5', 'matt', 'A'),
  ('dddd0000-0000-0000-0000-000000000006', 'U6', 'matt', 'A'),
  ('dddd0000-0000-0000-0000-000000000007', 'U7', 'matt', 'A');
insert into contact_events (client_id, advisor, type, event_date) values
  ('dddd0000-0000-0000-0000-000000000001', 'matt', 'meeting', current_date - 200),
  ('dddd0000-0000-0000-0000-000000000001', 'matt', 'meeting', current_date - 20),
  ('dddd0000-0000-0000-0000-000000000001', 'matt', 'call',    current_date - 100),
  ('dddd0000-0000-0000-0000-000000000002', 'matt', 'meeting', current_date - 100),
  ('dddd0000-0000-0000-0000-000000000002', 'matt', 'call',    current_date - 40),
  ('dddd0000-0000-0000-0000-000000000003', 'matt', 'call',    current_date - 200);
update clients set next_meeting_date = current_date + 20 where id = 'dddd0000-0000-0000-0000-000000000002';
select snooze_touch('dddd0000-0000-0000-0000-000000000002', 'meeting', current_date + 20);
select snooze_touch('dddd0000-0000-0000-0000-000000000003', 'call',    current_date + 3);
select plan_outreach('[{"client_id":"dddd0000-0000-0000-0000-000000000004","due_date":"2030-01-01"}]'::jsonb);

insert into contact_events (client_id, advisor, type, event_date) values
  ('dddd0000-0000-0000-0000-000000000005', 'matt', 'meeting', current_date - 100),
  ('dddd0000-0000-0000-0000-000000000006', 'matt', 'meeting', current_date - 100);
update clients set next_meeting_date = current_date + 9
 where id = 'dddd0000-0000-0000-0000-000000000005';
select snooze_touch('dddd0000-0000-0000-0000-000000000005', 'meeting', current_date + 9);
insert into contact_events (client_id, advisor, type, event_date)
  values ('dddd0000-0000-0000-0000-000000000005', 'matt', 'call', current_date);
update clients set next_meeting_date = current_date - 3
 where id = 'dddd0000-0000-0000-0000-000000000006';

-- U7: one sit-down logged twice in one go (same day, same created_at), and
-- the next meeting booked. The old engine broke that tie arbitrarily; pin it
-- to the lower id, which the new engine's id tie-break won't pick, so the
-- recompute inside 0013 changes the row's source and clears the booking.
insert into contact_events (id, client_id, advisor, type, event_date) values
  ('dddd0000-0000-0000-0000-0000000000a1', 'dddd0000-0000-0000-0000-000000000007', 'matt',      'meeting', current_date - 85),
  ('dddd0000-0000-0000-0000-0000000000a2', 'dddd0000-0000-0000-0000-000000000007', 'advisor_b', 'meeting', current_date - 85);
update due_dates set computed_from_event_id = 'dddd0000-0000-0000-0000-0000000000a1'
 where client_id = 'dddd0000-0000-0000-0000-000000000007' and type = 'meeting';
update clients set next_meeting_date = current_date + 30
 where id = 'dddd0000-0000-0000-0000-000000000007';
select snooze_touch('dddd0000-0000-0000-0000-000000000007', 'meeting', current_date + 30);

do $$
declare n int; d record;
begin
  select count(*) into n from tasks
   where client_id = 'dddd0000-0000-0000-0000-000000000001' and type = 'call' and status = 'open';
  assert n = 1, 'before 0013 U1 has an overdue call on the queue';
  -- The old bug, reproduced: logging U5's call un-parked its booked meeting.
  select * into strict d from due_dates where client_id = 'dddd0000-0000-0000-0000-000000000005' and type = 'meeting';
  assert d.snoozed_until is null, 'before 0013 the call un-parked U5''s booking';
  select count(*) into n from tasks
   where client_id = 'dddd0000-0000-0000-0000-000000000005' and type = 'meeting' and status = 'open';
  assert n = 1, 'so its booked meeting is back on the queue';
end $$;
SQL

run -f "$(pwd)/supabase/migrations/0013_meetings_cover_calls.sql" > /dev/null

check_0013() {
run <<'SQL'
do $$
declare d record; n int;
begin
  select * into strict d from due_dates where client_id = 'dddd0000-0000-0000-0000-000000000001' and type = 'call';
  assert d.due_date = current_date - 200 + 365, 'U1 call now waits on its meetings, got ' || d.due_date;
  select count(*) into n from tasks
   where client_id = 'dddd0000-0000-0000-0000-000000000001' and type = 'call' and status = 'open';
  assert n = 0, 'and is off the queue';

  select * into strict d from due_dates where client_id = 'dddd0000-0000-0000-0000-000000000002' and type = 'meeting';
  assert d.snoozed_until = current_date + 20, 'the migration keeps U2''s booked meeting, got ' || coalesce(d.snoozed_until::text, 'null');
  select * into strict d from due_dates where client_id = 'dddd0000-0000-0000-0000-000000000002' and type = 'call';
  assert d.due_date = current_date - 10, 'U2 has one meeting: calls still due, got ' || d.due_date;

  select * into strict d from due_dates where client_id = 'dddd0000-0000-0000-0000-000000000003' and type = 'call';
  assert d.snoozed_until = current_date + 3, 'the migration keeps U3''s voicemail snooze';
  assert d.due_date = current_date - 20, 'U3 call unchanged, got ' || d.due_date;

  select count(*) into n from due_dates where client_id = 'dddd0000-0000-0000-0000-000000000004' and computed_from_event_id is null;
  assert n = 1, 'the outreach placeholder survives';

  select * into strict d from due_dates where client_id = 'dddd0000-0000-0000-0000-000000000005' and type = 'meeting';
  assert d.snoozed_until = current_date + 9, '0013 puts back U5''s booking, got ' || coalesce(d.snoozed_until::text, 'null');
  select count(*) into n from tasks
   where client_id = 'dddd0000-0000-0000-0000-000000000005' and type = 'meeting' and status = 'open';
  assert n = 0, 'and takes its meeting off the queue';

  select * into strict d from due_dates where client_id = 'dddd0000-0000-0000-0000-000000000006' and type = 'meeting';
  assert d.snoozed_until is null, 'a booking whose day has passed is left alone';

  select * into strict d from due_dates where client_id = 'dddd0000-0000-0000-0000-000000000007' and type = 'meeting';
  assert d.computed_from_event_id = 'dddd0000-0000-0000-0000-0000000000a2', 'the new tie-break moved U7''s source';
  assert d.snoozed_until = current_date + 30, 'and U7''s booking still stands, got ' || coalesce(d.snoozed_until::text, 'null');
  select count(*) into n from tasks
   where client_id = 'dddd0000-0000-0000-0000-000000000007' and type = 'meeting' and status = 'open';
  assert n = 0, 'so its meeting stays off the queue';
end $$;
SQL
}
check_0013
run <<'SQL'
do $$
declare n int;
begin
  select count(*) into n from service_models where meetings_cover_calls = 2;
  assert n = 4, '0013 turns it on for S, A, B and C, got ' || n;
end $$;
SQL
echo "0013 reflows the book and keeps bookings, snoozes and placeholders"

# Re-running changes nothing, and never turns a tier back on.
run -c "update service_models set meetings_cover_calls = null where tier = 'C';" > /dev/null
run -f "$(pwd)/supabase/migrations/0013_meetings_cover_calls.sql" > /dev/null
check_0013
run <<'SQL'
do $$
declare v int;
begin
  select meetings_cover_calls into v from service_models where tier = 'C';
  assert v is null, 'a re-run leaves a tier the owner turned off, off';
  select meetings_cover_calls into v from service_models where tier = 'B';
  assert v = 2, 'and the rest on';
end $$;
SQL
echo "0013 is safe to re-run"

# The app saves the toggle as the signed-in user. Check the value really
# changed: a row-level policy could otherwise filter the update to nothing.
run <<'SQL'
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false) \g /dev/null
update service_models set meetings_cover_calls = null where tier = 'B';
do $$
declare v int;
begin
  select meetings_cover_calls into v from service_models where tier = 'B';
  assert v is null, 'authenticated turned B off';
end $$;
update service_models set meetings_cover_calls = 2 where tier = 'B';
do $$
declare v int;
begin
  select meetings_cover_calls into v from service_models where tier = 'B';
  assert v = 2, 'authenticated turned B back on';
end $$;
reset role;
SQL
echo "authenticated can turn it off and on"

echo "ALL_UPGRADE_ASSERTIONS_PASSED"
