// Integration test: the demo adapter running the whole service loop
// against an in-memory storage, exactly as the browser does.

import { describe, expect, it } from "vitest";
import { createDemoAdapter } from "./demoAdapter";
import { addDays, todayISO } from "../dates";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("demo adapter — full service loop", () => {
  it("seeds a living dashboard: due-today and overdue work exists", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    const snap = await adapter.load();
    const today = todayISO();
    const open = snap.tasks.filter((t) => t.status === "open");

    expect(snap.clients.length).toBeGreaterThanOrEqual(12);
    expect(snap.serviceModels).toHaveLength(4); // S, A, B, C
    expect(open.some((t) => t.type === "call" && t.dueDate === today)).toBe(true);
    expect(open.some((t) => t.type === "meeting" && t.dueDate === today)).toBe(true);
    expect(open.filter((t) => t.dueDate < today).length).toBeGreaterThanOrEqual(3);
    // Overdue tasks carry escalated priority.
    for (const t of open.filter((x) => x.dueDate < today)) {
      expect(t.priority).toBe("high");
      expect(t.daysOverdue).toBeGreaterThan(0);
    }
  });

  it("logging a call settles the task and rolls the due date forward", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    const before = await adapter.load();
    const today = todayISO();

    const dueCall = before.tasks.find(
      (t) => t.status === "open" && t.type === "call" && t.dueDate === today,
    );
    expect(dueCall).toBeDefined();
    const clientId = dueCall!.clientId;
    const tier = before.clients.find((c) => c.id === clientId)!.tier;
    const interval = before.serviceModels.find((m) => m.tier === tier)!.callIntervalDays;

    const after = await adapter.logContact({
      clientId,
      advisor: "matt",
      type: "call",
      eventDate: today,
      durationMinutes: 15,
      notes: "Quarterly check-in",
    });

    const due = after.dueDates.find((d) => d.clientId === clientId && d.type === "call");
    expect(due!.dueDate).toBe(addDays(today, interval));
    // No open call task remains within the horizon for this client.
    expect(
      after.tasks.some((t) => t.clientId === clientId && t.type === "call" && t.status === "open"),
    ).toBe(false);
    // The settled task is kept as history.
    expect(
      after.tasks.some((t) => t.clientId === clientId && t.type === "call" && t.status === "done"),
    ).toBe(true);
  });

  it("admin touches never move the clock", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    const before = await adapter.load();
    const client = before.clients[0];
    const dueBefore = before.dueDates.filter((d) => d.clientId === client.id);

    const after = await adapter.logContact({
      clientId: client.id,
      advisor: "matt",
      type: "admin",
      eventDate: todayISO(),
      durationMinutes: 5,
      notes: null,
    });

    const dueAfter = after.dueDates.filter((d) => d.clientId === client.id);
    expect(dueAfter.map((d) => `${d.type}:${d.dueDate}`).sort()).toEqual(
      dueBefore.map((d) => `${d.type}:${d.dueDate}`).sort(),
    );
  });

  it("adding a household seeds the clock from real last-touch dates", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    await adapter.load();
    const today = todayISO();

    const snap = await adapter.addClient({
      householdName: "Test Household",
      assignedAdvisor: "joint",
      tier: "A",
      phone: null,
      redtailId: null,
      heldAway: false,
      heldAwayNote: null,
      lastMeetingDate: addDays(today, -10),
      lastCallDate: addDays(today, -35), // call overdue for Tier A (30d)
    });

    const created = snap.clients.find((c) => c.householdName === "Test Household")!;
    const meetingDue = snap.dueDates.find((d) => d.clientId === created.id && d.type === "meeting")!;
    const callDue = snap.dueDates.find((d) => d.clientId === created.id && d.type === "call")!;
    expect(meetingDue.dueDate).toBe(addDays(today, 80)); // -10 + 90
    expect(callDue.dueDate).toBe(addDays(today, -5)); // -35 + 30 → overdue

    const task = snap.tasks.find(
      (t) => t.clientId === created.id && t.type === "call" && t.status === "open",
    );
    expect(task?.priority).toBe("high");
    expect(task?.daysOverdue).toBe(5);
  });

  it("tier change and service model edits reflow the whole book", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    const before = await adapter.load();
    const clientB = before.clients.find((c) => c.tier === "B")!;

    // Promote a B household to A: same history, tighter clock.
    const promoted = await adapter.updateClient(clientB.id, { tier: "A" });
    const callDue = promoted.dueDates.find((d) => d.clientId === clientB.id && d.type === "call");
    const lastCall = promoted.contactEvents
      .filter((e) => e.clientId === clientB.id && e.type === "call")
      .map((e) => e.eventDate)
      .sort()
      .at(-1)!;
    expect(callDue!.dueDate).toBe(addDays(lastCall, 30));

    // Tighten Tier A calls to weekly: every A call due date moves to last+7.
    const reflowed = await adapter.updateServiceModel({
      tier: "A",
      meetingIntervalDays: 90,
      callIntervalDays: 7,
      minRevenue: null,
      description: null,
    });
    for (const c of reflowed.clients.filter((x) => x.tier === "A")) {
      const due = reflowed.dueDates.find((d) => d.clientId === c.id && d.type === "call");
      if (!due) continue;
      const last = reflowed.contactEvents
        .filter((e) => e.clientId === c.id && e.type === "call")
        .map((e) => e.eventDate)
        .sort()
        .at(-1)!;
      expect(due.dueDate).toBe(addDays(last, 7));
    }
  });

  it("deactivating a household clears its open tasks; reset reseeds", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    const before = await adapter.load();
    const overdueTask = before.tasks.find((t) => t.status === "open" && t.daysOverdue > 0)!;

    const after = await adapter.updateClient(overdueTask.clientId, { active: false });
    expect(
      after.tasks.some((t) => t.clientId === overdueTask.clientId && t.status === "open"),
    ).toBe(false);

    const reset = await adapter.reset!();
    expect(
      reset.tasks.some((t) => t.clientId === overdueTask.clientId && t.status === "open"),
    ).toBe(true);
  });

  it("deleteClient erases the household and all its history", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    const before = await adapter.load();
    const victim = before.clients[0];
    expect(before.contactEvents.some((e) => e.clientId === victim.id)).toBe(true);

    const after = await adapter.deleteClient(victim.id);
    expect(after.clients.some((c) => c.id === victim.id)).toBe(false);
    expect(after.contactEvents.some((e) => e.clientId === victim.id)).toBe(false);
    expect(after.dueDates.some((d) => d.clientId === victim.id)).toBe(false);
    expect(after.tasks.some((t) => t.clientId === victim.id)).toBe(false);
  });

  it("persists across adapter instances via storage", async () => {
    const storage = memoryStorage();
    const first = createDemoAdapter(storage);
    await first.load();
    const snap = await first.addClient({
      householdName: "Persisted Household",
      assignedAdvisor: "matt",
      tier: "C",
      phone: "419-555-0199",
      redtailId: "999",
      heldAway: false,
      heldAwayNote: null,
      lastMeetingDate: null,
      lastCallDate: null,
    });
    expect(snap.clients.some((c) => c.householdName === "Persisted Household")).toBe(true);

    const second = createDemoAdapter(storage);
    const reloaded = await second.load();
    expect(reloaded.clients.some((c) => c.householdName === "Persisted Household")).toBe(true);
  });
});
