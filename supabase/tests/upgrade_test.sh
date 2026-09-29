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
# `authenticated` role rather than as superuser.
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

echo "ALL_UPGRADE_ASSERTIONS_PASSED"
