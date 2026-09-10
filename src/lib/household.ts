// Who counts as "the household" when a touch covers a whole family.
//
// A family is nothing but a shared familyId — every member keeps its own tier,
// its own cadence and its own service clock. So a joint review is one
// conversation that has to be recorded against each member separately, and
// these helpers are how the rest of the app agrees on who "each member" is.
//
// The familyId guard matters more than it looks: without it, two nulls compare
// equal and you would silently select every un-familied household in the book.

import type { Client, ContactEvent } from "../types";
import { isMeaningfulContact } from "../types";
import { addDays } from "./dates";

/** Every household in this client's family, the client included. */
export function householdMembers(clients: Client[], client: Client): Client[] {
  if (!client.familyId) return [client];
  return clients.filter((c) => c.familyId === client.familyId);
}

/**
 * The rest of the family — the households a touch would *also* cover.
 * Archived households are left out: their clock isn't running, so logging
 * against them is noise. Anyone in another advisor's book is already absent
 * from `clients` (the snapshot is scoped before it reaches the UI), which is
 * exactly right — we can't write to them either.
 */
export function otherHouseholdMembers(clients: Client[], client: Client): Client[] {
  if (!client.familyId) return [];
  return clients.filter((c) => c.familyId === client.familyId && c.id !== client.id && c.active);
}

/** How far back a catch-up reaches — the same year the profile and score use. */
export const CATCH_UP_WINDOW_DAYS = 365;

export interface CatchUpItem {
  /** A touch on the starting household. */
  source: ContactEvent;
  /** Family members with no touch of that type on that date. */
  missing: Client[];
}

/**
 * Touches this household has that the rest of the family doesn't — the backlog
 * left behind by every joint meeting logged before the household toggle
 * existed, or logged from the other spouse's profile.
 *
 * Only meeting and call: those are the touches that move a clock, and a
 * household showing overdue for a meeting it attended is the whole complaint.
 * Copying admin notes and voicemails across would add noise and fix nothing.
 *
 * A member already holding a touch of the same type on the same date is
 * skipped, so running this twice does nothing the second time.
 */
export function planHouseholdCatchUp(
  clients: Client[],
  events: ContactEvent[],
  client: Client,
  today: string,
): CatchUpItem[] {
  const others = otherHouseholdMembers(clients, client);
  if (others.length === 0) return [];

  const windowStart = addDays(today, -CATCH_UP_WINDOW_DAYS);
  const held = new Set(
    events
      .filter((e) => e.clientId !== client.id)
      .map((e) => `${e.clientId}|${e.type}|${e.eventDate}`),
  );

  return events
    .filter(
      (e) =>
        e.clientId === client.id && isMeaningfulContact(e.type) && e.eventDate > windowStart,
    )
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
    .map((source) => ({
      source,
      missing: others.filter((m) => !held.has(`${m.id}|${source.type}|${source.eventDate}`)),
    }))
    .filter((item) => item.missing.length > 0);
}
