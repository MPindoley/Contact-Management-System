// Initial-outreach planning: turn the never-contacted clients into a paced
// backlog of first-touch calls. Pure + tested. The plan is just a set of
// future "call due" dates with no backing event (computed_from_event_id is
// null) — the marker for a first-outreach placeholder. The moment a real
// contact is logged, the engine replaces it with the true cadence.
//
// Two things keep this from becoming an avalanche: the dates are spread a few
// per weekday, AND the normal 14-day task horizon only surfaces the imminent
// ones, so most of the backlog stays out of sight until its day approaches.

import type { Client, ContactEvent, DueDate } from "../types";
import { isMeaningfulContact, TIER_RANK } from "../types";
import { addDays, nextWeekday } from "../lib/dates";

export interface OutreachItem {
  clientId: string;
  dueDate: string;
}

export interface OutreachOptions {
  /** First date to schedule from (normalized to a weekday). */
  startDate: string;
  /** How many first-touches to schedule per weekday. */
  perWeekday: number;
}

/**
 * Active clients with no contact history and no due date yet — the ones
 * currently invisible to the system. Ordered Tier A → B → C, then by name,
 * so the most valuable relationships are reached first.
 */
export function outreachCandidates(
  clients: Client[],
  events: ContactEvent[],
  dueDates: DueDate[],
): Client[] {
  const contacted = new Set(
    events.filter((e) => isMeaningfulContact(e.type)).map((e) => e.clientId),
  );
  const hasDue = new Set(dueDates.map((d) => d.clientId));
  return clients
    .filter((c) => c.active && !contacted.has(c.id) && !hasDue.has(c.id))
    .sort(
      (a, b) =>
        TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.householdName.localeCompare(b.householdName),
    );
}

export function planInitialOutreach(
  clients: Client[],
  events: ContactEvent[],
  dueDates: DueDate[],
  opts: OutreachOptions,
): OutreachItem[] {
  const candidates = outreachCandidates(clients, events, dueDates);
  const perDay = Math.max(1, Math.floor(opts.perWeekday));
  let cursor = nextWeekday(opts.startDate);

  const items: OutreachItem[] = [];
  candidates.forEach((client, i) => {
    if (i > 0 && i % perDay === 0) cursor = nextWeekday(addDays(cursor, 1));
    items.push({ clientId: client.id, dueDate: cursor });
  });
  return items;
}

export interface OutreachSummary {
  count: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Number of distinct weekdays the plan spans. */
  weekdays: number;
}

export function summarizeOutreach(items: OutreachItem[]): OutreachSummary {
  if (items.length === 0) return { count: 0, firstDate: null, lastDate: null, weekdays: 0 };
  const dates = items.map((i) => i.dueDate);
  return {
    count: items.length,
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    weekdays: new Set(dates).size,
  };
}
