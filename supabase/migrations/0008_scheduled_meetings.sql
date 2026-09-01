-- ============================================================================
-- Relationship Hub — upgrade: book upcoming meetings on a household.
-- Run on a database already on 0001–0007. Idempotent and single-step.
--
-- Adds the two columns behind "Upcoming meeting" on the client profile. A
-- booked meeting is display-only: it NEVER credits the service score. It is
-- kept off the morning queue by the existing due_dates.snoozed_until overlay
-- (set to the meeting date), so no engine or trigger changes are needed —
-- when the day arrives the meeting surfaces again, and logging it clears the
-- booking.
-- ============================================================================

alter table clients add column if not exists next_meeting_date date;
alter table clients add column if not exists next_meeting_note text;

notify pgrst, 'reload schema';
