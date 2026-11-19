-- ============================================================================
-- Relationship Hub — upgrade: two meetings in a year cover the calls.
-- Run on a database already on 0001–0012. Single step; safe to re-run.
--
-- The calls are there to keep in touch between meetings. So if a household
-- has had two meetings (on two different days) in the last 12 months, its
-- call requirement is met: the next call isn't due until the older of those
-- two meetings is a year old. If the meetings slip, the call comes back.
--
-- It is a per-tier setting on the Tiers screen (service_models.
-- meetings_cover_calls: 2 = on, null = off). This turns it on for every tier.
-- Re-running it never turns a tier back on that was turned off afterwards.
--
-- Also fixed here: logging a call used to un-book a booked meeting (and any
-- tier edit un-parked the whole book), because every recompute cleared every
-- snooze. Now a snooze only clears when a new contact of its own type lands,
-- and the first run puts back the bookings that were already un-parked.
-- ============================================================================
begin;

create or replace function fn_recompute_client_due_dates(p_client uuid) returns void
language plpgsql security definer set search_path = public as $$
-- The database twin of computeClientDueDates() in src/engine/serviceEngine.ts.
-- Keep the two identical; supabase/tests/parity_test.sh checks that they are.
declare
  v_tier      client_tier;
  v_mi        int;                     -- meeting interval (days)
  v_ci        int;                     -- call interval (days)
  v_n         int;                     -- meetings_cover_calls; null = off
  v_lm_id     uuid; v_lm_date  date;   -- latest meeting
  v_lc_id     uuid; v_lc_date  date;   -- latest call
  v_old_id    uuid; v_old_date date;   -- oldest meeting of the latest covering run
  v_cover_end date;                    -- the day the meetings stop covering the calls
  v_call_due  date; v_call_src uuid; v_call_covered boolean := false;
begin
  select c.tier, sm.meeting_interval_days, sm.call_interval_days, sm.meetings_cover_calls
    into v_tier, v_mi, v_ci, v_n
    from clients c join service_models sm on sm.tier = c.tier
   where c.id = p_client;
  if v_tier is null then
    return;
  end if;

  -- "The latest" everywhere means: by date, then by when it was logged, then
  -- by id. The TypeScript twin is isLater().
  select e.id, e.event_date into v_lm_id, v_lm_date
    from contact_events e
   where e.client_id = p_client and e.type = 'meeting'
   order by e.event_date desc, e.created_at desc, e.id desc
   limit 1;

  select e.id, e.event_date into v_lc_id, v_lc_date
    from contact_events e
   where e.client_id = p_client and e.type = 'call'
   order by e.event_date desc, e.created_at desc, e.id desc
   limit 1;

  -- Meetings cover the calls (callCover() in TypeScript): N meetings on
  -- distinct days, within a year of each other, take care of the calls until
  -- the oldest of them is a year old. The latest such run of N wins; usually
  -- the N most recent, but not when those are more than a year apart. A
  -- meeting dated after the day it was logged (a CSV typo) never counts. 365
  -- is SCORE_WINDOW_DAYS, the same window the service score uses, so the call
  -- comes back onto the queue the same day the score stops crediting it.
  if v_n between 2 and 12 then
    select w.id, w.event_date into v_old_id, v_old_date
      from (select x.id, x.event_date,
                   -- the newest day of the run of N that starts at this one
                   lead(x.event_date, v_n - 1) over (order by x.event_date) as run_newest
              from (select distinct on (e.event_date) e.id, e.event_date
                      from contact_events e
                     where e.client_id = p_client
                       and e.type = 'meeting'
                       and e.event_date <= (e.created_at at time zone 'utc')::date
                     order by e.event_date desc, e.created_at desc, e.id desc) x) w
     where w.event_date + 365 > w.run_newest
     order by w.event_date desc
     limit 1;
    if v_old_id is not null then
      v_cover_end := v_old_date + 365;
    end if;
  end if;

  -- The call: last call + call interval, pushed back to the cover's end if the
  -- cover reaches further. A tie goes to the call. With no call ever logged
  -- there is no call row at all: the rule only ever pushes a call later, it
  -- never creates one.
  if v_lc_id is not null then
    if v_cover_end is not null and v_cover_end > v_lc_date + v_ci then
      v_call_due := v_cover_end;       v_call_src := v_old_id;  v_call_covered := true;
    else
      v_call_due := v_lc_date + v_ci;  v_call_src := v_lc_id;
    end if;
  end if;

  -- A snooze (a voicemail's "try again", a booked meeting) survives a
  -- recompute that doesn't change where the row comes from. So logging a call
  -- no longer un-books the booked meeting, and a tier edit no longer un-parks
  -- the whole book. A fresh contact of the row's own type still clears it.
  if v_lm_id is not null then
    insert into due_dates as d (client_id, type, due_date, computed_from_event_id, updated_at)
    values (p_client, 'meeting', v_lm_date + v_mi, v_lm_id, now())
    on conflict (client_id, type) do update
      set due_date               = excluded.due_date,
          snoozed_until          = case when d.computed_from_event_id is not distinct from excluded.computed_from_event_id
                                        then d.snoozed_until else null end,
          computed_from_event_id = excluded.computed_from_event_id,
          updated_at             = now();
  end if;

  if v_call_src is not null then
    insert into due_dates as d (client_id, type, due_date, computed_from_event_id, updated_at)
    values (p_client, 'call', v_call_due, v_call_src, now())
    on conflict (client_id, type) do update
      set due_date               = excluded.due_date,
          -- A call row moving onto its cover keeps its snooze too: that only
          -- happens when the call was pushed later, so it is harmless.
          snoozed_until          = case when v_call_covered
                                          or d.computed_from_event_id is not distinct from excluded.computed_from_event_id
                                        then d.snoozed_until else null end,
          computed_from_event_id = excluded.computed_from_event_id,
          updated_at             = now();
  end if;

  -- Drop event-derived rows this pass did not produce. (0002 checked for an
  -- event of the row's own type, which would delete a call row whose source is
  -- a covering meeting.)
  delete from due_dates d
   where d.client_id = p_client
     and d.computed_from_event_id is not null
     and ((d.type = 'meeting' and v_lm_id is null) or (d.type = 'call' and v_call_src is null));

  -- First-outreach placeholders give way once the client has any real contact.
  delete from due_dates d
   where d.client_id = p_client
     and d.computed_from_event_id is null
     and exists (select 1 from contact_events e
                  where e.client_id = p_client and e.type in ('meeting', 'call'));
end $$;

-- First run only: add the column and turn the rule on for S, A, B and C. The
-- service_models trigger then recomputes every household's due dates (with
-- the function above) and rebuilds the queue, all inside this transaction.
-- On a re-run the column already exists and nothing here happens, so a tier
-- turned off on the Tiers screen stays off.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'service_models'
       and column_name = 'meetings_cover_calls'
  ) then
    alter table service_models add column meetings_cover_calls int
      check (meetings_cover_calls is null or meetings_cover_calls between 2 and 12);
    update service_models set meetings_cover_calls = 2;

    -- Then put back the bookings the old engine already un-parked. Booking a
    -- meeting sets clients.next_meeting_date and parks the meeting row until
    -- that day; the app has no way to un-park one without cancelling the
    -- booking, so a future booking with nothing parked (or a snooze that has
    -- already run out) can only be the old bug's doing. This goes after the
    -- recompute above, not before: where two meetings tie on date and time,
    -- the recompute's new tie-break can pick the other one, which clears the
    -- snooze one last time.
    update due_dates d
       set snoozed_until = c.next_meeting_date, updated_at = now()
      from clients c
     where c.id = d.client_id
       and d.type = 'meeting'
       and c.next_meeting_date > current_date
       and (d.snoozed_until is null or d.snoozed_until <= current_date);
    perform rebuild_tasks(current_date);
  end if;
end $$;

comment on column service_models.meetings_cover_calls is
  'Meeting this many times (distinct days) in a trailing 12 months meets the call requirement. null = off. Mirrors callCover() in src/engine/serviceEngine.ts.';

commit;

notify pgrst, 'reload schema';
