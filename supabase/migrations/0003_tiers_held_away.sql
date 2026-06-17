-- ============================================================================
-- Relationship Hub — upgrade: new "S" tier, editable tier criteria, and the
-- held-away "money to capture" flag. Run on a database already on 0001/0002.
--
-- IMPORTANT: Postgres won't let a new enum value be *used* in the same batch
-- it's *added*. So this comes in TWO steps — run STEP 1 by itself first, then
-- run STEP 2. (If you run it all at once and it errors on the S service-model
-- insert, just run STEP 1 alone, then STEP 2.)
-- ============================================================================

-- ──────────────────────────── STEP 1 (run alone) ───────────────────────────
alter type client_tier add value if not exists 'S' before 'A';


-- ──────────────────────────── STEP 2 (run after) ───────────────────────────
-- New columns (idempotent).
alter table clients        add column if not exists held_away boolean not null default false;
alter table clients        add column if not exists held_away_note text;
alter table service_models add column if not exists min_revenue numeric;
alter table service_models add column if not exists description text;

-- The S tier's service model (same top cadence as A by default — edit it on
-- the Tiers screen to make it more aggressive, or loosen A beneath it).
insert into service_models (tier, meeting_interval_days, call_interval_days, min_revenue, description)
values ('S', 90, 30, 250000, 'Your very top households — protect these above all.')
on conflict (tier) do nothing;

-- Seed criteria on existing tiers only where they're still blank (non-destructive).
update service_models set min_revenue = 100000 where tier = 'A' and min_revenue is null;
update service_models set min_revenue =  25000 where tier = 'B' and min_revenue is null;
update service_models set description = 'Core high-value households.'
  where tier = 'A' and description is null;
update service_models set description = 'The steady middle of the book.'
  where tier = 'B' and description is null;
update service_models set description = 'Lighter-touch relationships, kept warm.'
  where tier = 'C' and description is null;

-- Base table privileges (RLS still decides which rows are visible).
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Refresh the API layer so the new columns/values are usable immediately.
notify pgrst, 'reload schema';
