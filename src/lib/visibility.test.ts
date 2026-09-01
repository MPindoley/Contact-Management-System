import { describe, expect, it } from "vitest";
import { clientVisibleTo, prospectVisibleTo, scopeSnapshot } from "./visibility";
import type { Client, DataSnapshot, Prospect, User } from "../types";

const matt: User = { id: "u1", name: "Matt", email: null, role: "advisor", advisorKey: "matt", seesAllBooks: true };
const beau: User = { id: "u2", name: "Beau", email: null, role: "advisor", advisorKey: "advisor_b", seesAllBooks: false };
const carolyn: User = { id: "u3", name: "Carolyn", email: null, role: "assistant", advisorKey: null, seesAllBooks: true };

let seq = 0;
const mkClient = (o: Partial<Client> = {}): Client => ({
  id: `c${seq++}`, householdName: "H", assignedAdvisor: "matt", tier: "B", active: true,
  phone: null, redtailId: null, revenue: null, heldAway: false, heldAwayNote: null,
  familyId: null, familyRole: null, tags: [],
  nextMeetingDate: null, nextMeetingNote: null, createdAt: "", ...o,
});
const mkProspect = (o: Partial<Prospect> = {}): Prospect => ({
  id: `p${seq++}`, name: "P", assignedAdvisor: "matt", phone: null, status: "new",
  notes: null, nextFollowUp: null, createdAt: "", updatedAt: "", ...o,
});

describe("clientVisibleTo", () => {
  it("Matt (sees all) and Carolyn see every book; Beau only his + joint", () => {
    const mattClient = mkClient({ assignedAdvisor: "matt" });
    const beauClient = mkClient({ assignedAdvisor: "advisor_b" });
    const jointClient = mkClient({ assignedAdvisor: "joint" });

    expect(clientVisibleTo(beauClient, matt)).toBe(true);
    expect(clientVisibleTo(beauClient, carolyn)).toBe(true);

    expect(clientVisibleTo(mattClient, beau)).toBe(false); // Beau cannot see Matt's
    expect(clientVisibleTo(beauClient, beau)).toBe(true);
    expect(clientVisibleTo(jointClient, beau)).toBe(true);
  });
});

describe("prospectVisibleTo", () => {
  it("each advisor sees only their own; the assistant sees all", () => {
    const mattP = mkProspect({ assignedAdvisor: "matt" });
    const beauP = mkProspect({ assignedAdvisor: "advisor_b" });

    // Even Matt (sees all clients) does NOT see Beau's prospects.
    expect(prospectVisibleTo(beauP, matt)).toBe(false);
    expect(prospectVisibleTo(mattP, matt)).toBe(true);
    expect(prospectVisibleTo(mattP, beau)).toBe(false);
    expect(prospectVisibleTo(beauP, beau)).toBe(true);
    // Carolyn sees both.
    expect(prospectVisibleTo(mattP, carolyn)).toBe(true);
    expect(prospectVisibleTo(beauP, carolyn)).toBe(true);
  });
});

describe("scopeSnapshot", () => {
  const mattClient = mkClient({ id: "cm", assignedAdvisor: "matt", familyId: "fam-m" });
  const beauClient = mkClient({ id: "cb", assignedAdvisor: "advisor_b" });
  const snapshot: DataSnapshot = {
    users: [matt, beau, carolyn],
    clients: [mattClient, beauClient],
    serviceModels: [],
    contactEvents: [
      { id: "e1", clientId: "cm", advisor: "matt", type: "call", eventDate: "2026-06-01", durationMinutes: null, notes: null, createdAt: "" },
      { id: "e2", clientId: "cb", advisor: "advisor_b", type: "call", eventDate: "2026-06-01", durationMinutes: null, notes: null, createdAt: "" },
    ],
    dueDates: [
      { id: "d1", clientId: "cm", type: "call", dueDate: "2026-07-01", computedFromEventId: null, snoozedUntil: null, updatedAt: "" },
      { id: "d2", clientId: "cb", type: "call", dueDate: "2026-07-01", computedFromEventId: null, snoozedUntil: null, updatedAt: "" },
    ],
    tasks: [
      { id: "t1", clientId: "cm", type: "call", dueDate: "2026-07-01", daysOverdue: 0, priority: "low", status: "open", createdAt: "" },
      { id: "t2", clientId: "cb", type: "call", dueDate: "2026-07-01", daysOverdue: 0, priority: "low", status: "open", createdAt: "" },
    ],
    prospects: [mkProspect({ id: "pm", assignedAdvisor: "matt" }), mkProspect({ id: "pb", assignedAdvisor: "advisor_b" })],
    prospectEvents: [
      { id: "pe1", prospectId: "pm", advisor: "matt", type: "call", eventDate: "2026-06-01", notes: null, createdAt: "" },
      { id: "pe2", prospectId: "pb", advisor: "advisor_b", type: "call", eventDate: "2026-06-01", notes: null, createdAt: "" },
    ],
    families: [{ id: "fam-m", name: "Matt Family", createdAt: "" }],
  };

  it("hides Matt's clients (and everything off them) from Beau", () => {
    const scoped = scopeSnapshot(snapshot, beau);
    expect(scoped.clients.map((c) => c.id)).toEqual(["cb"]);
    expect(scoped.contactEvents.map((e) => e.id)).toEqual(["e2"]);
    expect(scoped.dueDates.map((d) => d.id)).toEqual(["d2"]);
    expect(scoped.tasks.map((t) => t.id)).toEqual(["t2"]);
    expect(scoped.families).toHaveLength(0); // Matt's family is hidden
    expect(scoped.prospects.map((p) => p.id)).toEqual(["pb"]);
    expect(scoped.prospectEvents.map((e) => e.id)).toEqual(["pe2"]);
  });

  it("shows Matt all clients but only his own prospects", () => {
    const scoped = scopeSnapshot(snapshot, matt);
    expect(scoped.clients.map((c) => c.id).sort()).toEqual(["cb", "cm"]);
    expect(scoped.prospects.map((p) => p.id)).toEqual(["pm"]); // not Beau's
  });

  it("shows Carolyn everything", () => {
    const scoped = scopeSnapshot(snapshot, carolyn);
    expect(scoped.clients).toHaveLength(2);
    expect(scoped.prospects).toHaveLength(2);
  });
});
