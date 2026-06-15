// Tiny pure helpers for deriving view data from the snapshot.

import type { Client, ContactEvent, DataSnapshot, DueDate, Task } from "../types";

export function clientsById(data: DataSnapshot): Map<string, Client> {
  return new Map(data.clients.map((c) => [c.id, c]));
}

/** Latest meaningful (non-admin) touch for a client, if any. */
export function latestContactFor(events: ContactEvent[], clientId: string): ContactEvent | null {
  return events
    .filter((e) => e.clientId === clientId && e.type !== "admin")
    .reduce<ContactEvent | null>((best, e) => {
      if (!best) return e;
      if (e.eventDate > best.eventDate) return e;
      if (e.eventDate === best.eventDate && e.createdAt > best.createdAt) return e;
      return best;
    }, null);
}

/** The next thing due for a client (earliest due date across touch types). */
export function nextDueFor(dueDates: DueDate[], clientId: string): DueDate | null {
  return dueDates
    .filter((d) => d.clientId === clientId)
    .reduce<DueDate | null>((best, d) => (!best || d.dueDate < best.dueDate ? d : best), null);
}

export function openTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.status === "open");
}

/** Keys ("clientId:type") of due dates that are first-outreach placeholders. */
export function outreachKeys(dueDates: DueDate[]): Set<string> {
  return new Set(
    dueDates.filter((d) => d.computedFromEventId === null).map((d) => `${d.clientId}:${d.type}`),
  );
}

const TIER_ORDER = { A: 0, B: 1, C: 2 } as const;

/** Sort tasks for a "due today" column: Tier A first, then by name. */
export function sortByTierThenName(tasks: Task[], byId: Map<string, Client>): Task[] {
  return [...tasks].sort((a, b) => {
    const ca = byId.get(a.clientId);
    const cb = byId.get(b.clientId);
    if (!ca || !cb) return 0;
    const tier = TIER_ORDER[ca.tier] - TIER_ORDER[cb.tier];
    return tier !== 0 ? tier : ca.householdName.localeCompare(cb.householdName);
  });
}
