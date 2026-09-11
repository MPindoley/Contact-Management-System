-- ============================================================================
-- Relationship Hub — upgrade: choose which household members mirror a touch.
-- Run on a database already on 0001–0009. Idempotent and single-step.
--
-- 0009 made a touch cover the whole family. That is right for a couple and
-- wrong for a child, a trust, or an old account kept for one holding: they
-- are in the family but they were not in the room, and a meeting they never
-- attended should not reset their clock.
--
-- This is a standing rule per member rather than a decision you re-make every
-- time you log something. Everyone starts on, which is why the default is
-- true -- existing households behave exactly as they did before.
--
-- It is not a lock. Log Contact still lists a member whose rule is off, just
-- switched off, so a one-off "actually, they were there today" is one tap.
-- ============================================================================

alter table clients add column if not exists mirror_touches boolean not null default true;

notify pgrst, 'reload schema';
