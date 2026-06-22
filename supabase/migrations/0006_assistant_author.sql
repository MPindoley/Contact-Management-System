-- ============================================================================
-- Relationship Hub — upgrade: let the assistant log contacts under her own name.
-- Run on a database already on 0001–0005. Idempotent and single-step.
--
-- Adds 'assistant' to the advisor_assignment enum so a contact_events.advisor /
-- prospect_events.advisor can credit the assistant (Carolyn), not just the two
-- advisors. The existing "advisor <> 'joint'" checks already allow the new
-- value, so nothing else changes. 'assistant' is never used as a client
-- assignment — the app keeps it out of those pickers.
-- ============================================================================

alter type advisor_assignment add value if not exists 'assistant';

notify pgrst, 'reload schema';
