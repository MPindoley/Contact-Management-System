// Per-advisor visibility. The senior advisor and the assistant see every
// book; a restricted advisor sees only their own households (plus joint).
// Prospects are stricter: each advisor sees ONLY their own; the assistant
// sees all. Applied in the app for the UI, and enforced again by row-level
// security in the database (supabase/migrations/0001_init.sql).

import type { Client, DataSnapshot, Prospect, User } from "../types";

/** Can this user see this household? */
export function clientVisibleTo(client: Client, user: User): boolean {
  if (user.seesAllBooks) return true;
  return client.assignedAdvisor === user.advisorKey || client.assignedAdvisor === "joint";
}

/** Prospects are private per advisor; only the assistant sees them all. */
export function prospectVisibleTo(prospect: Prospect, user: User): boolean {
  if (user.role === "assistant") return true;
  return prospect.assignedAdvisor === user.advisorKey || prospect.assignedAdvisor === "joint";
}

/**
 * Narrow a snapshot to what `user` is allowed to see. Everything that hangs
 * off a hidden client/prospect is filtered out too, so no screen can leak it.
 */
export function scopeSnapshot(snapshot: DataSnapshot, user: User): DataSnapshot {
  const clients = snapshot.clients.filter((c) => clientVisibleTo(c, user));
  const clientIds = new Set(clients.map((c) => c.id));
  const familyIds = new Set(clients.map((c) => c.familyId).filter((id): id is string => !!id));

  const prospects = snapshot.prospects.filter((p) => prospectVisibleTo(p, user));
  const prospectIds = new Set(prospects.map((p) => p.id));

  return {
    ...snapshot,
    clients,
    contactEvents: snapshot.contactEvents.filter((e) => clientIds.has(e.clientId)),
    dueDates: snapshot.dueDates.filter((d) => clientIds.has(d.clientId)),
    tasks: snapshot.tasks.filter((t) => clientIds.has(t.clientId)),
    families: snapshot.families.filter((f) => familyIds.has(f.id)),
    prospects,
    prospectEvents: snapshot.prospectEvents.filter((e) => prospectIds.has(e.prospectId)),
  };
}
