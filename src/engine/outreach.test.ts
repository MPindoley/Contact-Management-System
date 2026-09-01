import { describe, expect, it } from "vitest";
import {
  outreachCandidates,
  planInitialOutreach,
  summarizeOutreach,
} from "./outreach";
import type { Client, ContactEvent, DueDate } from "../types";

let seq = 0;
function mkClient(o: Partial<Client> = {}): Client {
  seq += 1;
  return {
    id: `c${seq}`,
    householdName: `Household ${String(seq).padStart(2, "0")}`,
    assignedAdvisor: "matt",
    tier: "B",
    active: true,
    phone: null,
    redtailId: null,
    revenue: null,
    heldAway: false,
    heldAwayNote: null,
    familyId: null,
    familyRole: null,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...o,
  };
}

describe("outreachCandidates", () => {
  it("selects only active, never-contacted, due-date-free clients, A→B→C", () => {
    const a = mkClient({ tier: "A", householdName: "Zeta" });
    const b = mkClient({ tier: "B", householdName: "Alpha" });
    const c = mkClient({ tier: "C", householdName: "Mu" });
    const contacted = mkClient({ tier: "A", householdName: "Contacted" });
    const hasDue = mkClient({ tier: "A", householdName: "HasDue" });
    const inactive = mkClient({ tier: "A", active: false });

    const events: ContactEvent[] = [
      {
        id: "e1",
        clientId: contacted.id,
        advisor: "matt",
        type: "call",
        eventDate: "2026-06-01",
        durationMinutes: null,
        notes: null,
        createdAt: "2026-06-01T00:00:00Z",
      },
      // admin-only contact does NOT count as having been reached
      {
        id: "e2",
        clientId: a.id,
        advisor: "matt",
        type: "admin",
        eventDate: "2026-06-01",
        durationMinutes: null,
        notes: null,
        createdAt: "2026-06-01T00:00:00Z",
      },
    ];
    const dueDates: DueDate[] = [
      {
        id: "d1",
        clientId: hasDue.id,
        type: "call",
        dueDate: "2026-07-01",
        computedFromEventId: "x",
        snoozedUntil: null,
        updatedAt: "2026-06-01T00:00:00Z",
      },
    ];

    const result = outreachCandidates([a, b, c, contacted, hasDue, inactive], events, dueDates);
    // a (admin-only) still a candidate; ordered A(Zeta), B(Alpha), C(Mu)
    expect(result.map((r) => r.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe("planInitialOutreach", () => {
  it("paces N per weekday and skips weekends", () => {
    const clients = Array.from({ length: 5 }, () => mkClient({ tier: "B" }));
    // 2026-06-12 is a Friday.
    const plan = planInitialOutreach(clients, [], [], { startDate: "2026-06-12", perWeekday: 2 });

    const dates = plan.map((p) => p.dueDate);
    expect(dates[0]).toBe("2026-06-12"); // Fri
    expect(dates[1]).toBe("2026-06-12"); // Fri (2/day)
    expect(dates[2]).toBe("2026-06-15"); // skips Sat/Sun → Mon
    expect(dates[3]).toBe("2026-06-15"); // Mon
    expect(dates[4]).toBe("2026-06-16"); // Tue
  });

  it("normalizes a weekend start to Monday", () => {
    const clients = [mkClient()];
    const plan = planInitialOutreach(clients, [], [], { startDate: "2026-06-13", perWeekday: 4 }); // Sat
    expect(plan[0].dueDate).toBe("2026-06-15"); // Mon
  });

  it("orders Tier A households into the earliest slots", () => {
    const cClient = mkClient({ tier: "C", householdName: "Early Name" });
    const aClient = mkClient({ tier: "A", householdName: "Zzz Name" });
    const plan = planInitialOutreach([cClient, aClient], [], [], {
      startDate: "2026-06-15",
      perWeekday: 1,
    });
    expect(plan[0].clientId).toBe(aClient.id); // Tier A first despite later name
    expect(plan[0].dueDate).toBe("2026-06-15");
    expect(plan[1].dueDate).toBe("2026-06-16");
  });

  it("excludes contacted / already-scheduled clients from the plan", () => {
    const fresh = mkClient();
    const contacted = mkClient();
    const events: ContactEvent[] = [
      {
        id: "e",
        clientId: contacted.id,
        advisor: "matt",
        type: "call",
        eventDate: "2026-06-01",
        durationMinutes: null,
        notes: null,
        createdAt: "2026-06-01T00:00:00Z",
      },
    ];
    const plan = planInitialOutreach([fresh, contacted], events, [], {
      startDate: "2026-06-15",
      perWeekday: 5,
    });
    expect(plan.map((p) => p.clientId)).toEqual([fresh.id]);
  });

  it("summarizes the span for the preview", () => {
    const clients = Array.from({ length: 9 }, () => mkClient());
    const plan = planInitialOutreach(clients, [], [], { startDate: "2026-06-15", perWeekday: 4 });
    const summary = summarizeOutreach(plan);
    expect(summary.count).toBe(9);
    expect(summary.firstDate).toBe("2026-06-15"); // Mon
    expect(summary.weekdays).toBe(3); // 4 + 4 + 1
    expect(summary.lastDate).toBe("2026-06-17"); // Wed
    expect(summarizeOutreach([])).toEqual({ count: 0, firstDate: null, lastDate: null, weekdays: 0 });
  });
});
