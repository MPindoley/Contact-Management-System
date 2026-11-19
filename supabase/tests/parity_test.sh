#!/usr/bin/env bash
# The due-date rules exist twice: src/engine/serviceEngine.ts (demo mode, and
# what the app shows) and fn_recompute_client_due_dates() in Postgres (what a
# live database stores). This checks they agree:
#
#   1. the function in 0001 (fresh installs) and in 0013 (live databases) is
#      the same text, so there is only one database version to compare;
#   2. a seeded random history played into both gives identical due-date rows.
#
#   ./supabase/tests/parity_test.sh                 (needs a local postgres)
#   PARITY_SEEDS=7,8 PARITY_ROUNDS=40 ./supabase/tests/parity_test.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

python3 - <<'PY'
import re, sys
def fn(path):
    s = open(path).read()
    m = re.search(r"create or replace function fn_recompute_client_due_dates.*?\nend \$\$;\n", s, re.S)
    if not m: sys.exit(f"no fn_recompute_client_due_dates in {path}")
    return m.group(0)
if fn("supabase/migrations/0001_init.sql") != fn("supabase/migrations/0013_meetings_cover_calls.sql"):
    sys.exit("FAILED: fn_recompute_client_due_dates differs between 0001 and 0013")
print("0001 and 0013 carry the same recompute function")
PY

DB=rh_parity
sudo -u postgres psql -qc "drop database if exists $DB;"
sudo -u postgres psql -qc "create database $DB;"
run() { sudo -u postgres psql -v ON_ERROR_STOP=1 -qd "$DB" "$@"; }
run <<'SQL'
create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
do $$ begin if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$;
SQL
run -f "$(pwd)/supabase/migrations/0001_init.sql" > /dev/null

# A non-UTC zone on the TypeScript side too: date math must not drift.
TZ=America/Chicago PARITY_DB=$DB npx vitest run --config supabase/tests/vitest.parity.config.ts

echo "ALL_PARITY_ASSERTIONS_PASSED"
