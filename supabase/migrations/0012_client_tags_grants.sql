-- ============================================================================
-- Relationship Hub — fix: "permission denied for table client_tags".
-- Run on any database that has already had 0011. Idempotent.
--
-- 0011 created client_tags, enabled row-level security and added a policy, but
-- never granted the table itself to `authenticated`. Those are two different
-- gates and BOTH have to pass: a policy decides which ROWS you may touch, and
-- a grant decides whether you may touch the table at all. Without the grant
-- Postgres refuses before it ever consults the policy.
--
-- Why it was missed: 0001 says
--     grant select, insert, update, delete on all tables in schema public ...
-- and "all tables" means the tables that exist AT THAT MOMENT. On a fresh
-- project 0001 creates client_tags before that line runs, so it is covered —
-- which is exactly why the test harness stayed green. On a database that ran
-- 0001 months ago, a table created later by 0011 was never in scope.
--
-- Note the read failed too, not just the write; the app falls back to its
-- built-in tag list when it cannot read the table, so the list still looked
-- right. After this the app reads the real table.
-- ============================================================================

grant select, insert, update, delete on client_tags to authenticated;

-- And stop this recurring. Default privileges apply to tables created AFTER
-- this runs, so the next migration that adds a table is covered without anyone
-- remembering to write a grant.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

notify pgrst, 'reload schema';
