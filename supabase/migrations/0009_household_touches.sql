-- ============================================================================
-- Relationship Hub — upgrade: one conversation, logged for the whole household.
-- Run on a database already on 0001–0008. Idempotent and single-step.
--
-- A joint review is one meeting, but the two spouses are two households with
-- two tiers and two service clocks. So the app writes one contact_events row
-- per household — nothing about the engine changes, each clock still rolls
-- forward by its own tier's interval — and ties the rows together with a
-- shared group_id. That id is what lets the firm report say "3 meetings held"
-- instead of "7 meetings logged", and what marks a touch in the history as
-- one the whole family was part of.
--
-- Also fixes a cross-book data-loss bug in family tidy-up (see below).
-- ============================================================================

alter table contact_events add column if not exists group_id uuid;

create index if not exists contact_events_group_idx
  on contact_events (group_id) where group_id is not null;

-- ---------------------------------------------------------------------------
-- fn_prune_empty_families — delete family rows with no members left.
--
-- The app used to do this itself: read every family, read every client's
-- family_id, delete the families nobody pointed at. The bug is that the
-- clients read goes through row-level security and the families read does not
-- (families is `using (true)`). So for a restricted advisor — Beau — a family
-- whose remaining members are all in Matt's book looked EMPTY, and got
-- deleted. clients.family_id is `on delete set null`, so Matt's households
-- were silently unlinked from each other. It fired on every link, unlink and
-- household delete, and neither advisor was ever told.
--
-- Security definer fixes it at the root: the count now sees every book, so
-- "empty" means actually empty.
-- ---------------------------------------------------------------------------
create or replace function fn_prune_empty_families() returns void
language sql security definer set search_path = public as $$
  delete from families f
  where not exists (select 1 from clients c where c.family_id = f.id);
$$;

grant execute on function fn_prune_empty_families() to authenticated;

notify pgrst, 'reload schema';
