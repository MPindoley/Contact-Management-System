#!/usr/bin/env bash
# Verifies the per-advisor row-level security: Beau cannot see Matt's clients,
# Matt sees every client but only his own prospects, the assistant sees all.
# Runs queries as the `authenticated` role with a stubbed auth.uid().
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=rh_rls

sudo -u postgres psql -qc "drop database if exists $DB;"
sudo -u postgres psql -qc "create database $DB;"
run() { sudo -u postgres psql -v ON_ERROR_STOP=1 -qd "$DB" "$@"; }

# --- Supabase stub: auth schema + a settable auth.uid() ---------------------
run <<'SQL'
create schema auth;
create table auth.users (id uuid primary key, email text);
do $$ begin if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
-- auth.uid() reads a session GUC so the test can impersonate each user.
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
SQL

run -f "$(pwd)/supabase/migrations/0001_init.sql" >/dev/null

# --- Link the three people to auth users, seed scoped data ------------------
run <<'SQL'
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'matt@firm.com'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'beau@firm.com'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'carolyn@firm.com');
update users set auth_user_id = 'aaaaaaaa-0000-0000-0000-000000000001' where advisor_key = 'matt';
update users set auth_user_id = 'aaaaaaaa-0000-0000-0000-000000000002' where advisor_key = 'advisor_b';
update users set auth_user_id = 'aaaaaaaa-0000-0000-0000-000000000003' where role = 'assistant';

insert into clients (id, household_name, assigned_advisor, tier) values
  ('c1111111-0000-0000-0000-000000000001', 'Matt Client',  'matt',      'A'),
  ('c1111111-0000-0000-0000-000000000002', 'Beau Client',  'advisor_b', 'A'),
  ('c1111111-0000-0000-0000-000000000003', 'Joint Client', 'joint',     'A');
insert into contact_events (client_id, advisor, type, event_date) values
  ('c1111111-0000-0000-0000-000000000001', 'matt', 'call', current_date);
insert into prospects (name, assigned_advisor) values
  ('Matt Prospect', 'matt'), ('Beau Prospect', 'advisor_b');
SQL

# --- Assertions as each persona --------------------------------------------
assert_counts() {  # uid  expect_clients  expect_prospects  expect_matt_events  label
  run <<SQL
set role authenticated;
select set_config('test.uid', '$1', false);
do \$\$
declare nc int; np int; ne int;
begin
  select count(*) into nc from clients;
  select count(*) into np from prospects;
  select count(*) into ne from contact_events where client_id = 'c1111111-0000-0000-0000-000000000001';
  assert nc = $2, '$5: clients visible = '||nc||' (want $2)';
  assert np = $3, '$5: prospects visible = '||np||' (want $3)';
  assert ne = $4, '$5: matt-client events visible = '||ne||' (want $4)';
end \$\$;
reset role;
SQL
}

# Matt (sees all books): all 3 clients, his 1 prospect only, his event.
assert_counts 'aaaaaaaa-0000-0000-0000-000000000001' 3 1 1 'Matt'
# Beau: his client + joint = 2; his 1 prospect; CANNOT see Matt's event (0).
assert_counts 'aaaaaaaa-0000-0000-0000-000000000002' 2 1 0 'Beau'
# Carolyn (assistant): all 3 clients, both prospects, the event.
assert_counts 'aaaaaaaa-0000-0000-0000-000000000003' 3 2 1 'Carolyn'

# Beau must not be able to write into Matt's book either.
run <<'SQL'
set role authenticated;
select set_config('test.uid', 'aaaaaaaa-0000-0000-0000-000000000002', false);
do $$
declare blocked boolean := false;
begin
  begin
    update clients set tier = 'C' where id = 'c1111111-0000-0000-0000-000000000001';
    -- RLS makes the row invisible, so 0 rows update (no error, but no change).
  exception when others then blocked := true;
  end;
  assert (select tier from clients where id = 'c1111111-0000-0000-0000-000000000001') is null
         or true, 'sanity';
end $$;
reset role;
-- Confirm as superuser that Matt's client tier is unchanged by Beau.
do $$
declare t client_tier;
begin
  select tier into t from clients where id = 'c1111111-0000-0000-0000-000000000001';
  assert t = 'A', 'Beau must not change Matt''s client (tier now '||t||')';
end $$;
SQL

echo "ALL_RLS_ASSERTIONS_PASSED"
