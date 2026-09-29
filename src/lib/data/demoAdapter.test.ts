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
      revenue: null,
      heldAway: false,
      heldAwayNote: null,
      tags: [],
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
      revenue: null,
      heldAway: false,
      heldAwayNote: null,
      tags: [],
      lastMeetingDate: null,
      lastCallDate: null,
    });
    expect(snap.clients.some((c) => c.householdName === "Persisted Household")).toBe(true);

    const second = createDemoAdapter(storage);
    const reloaded = await second.load();
    expect(reloaded.clients.some((c) => c.householdName === "Persisted Household")).toBe(true);
  });
});

describe("booking an upcoming meeting", () => {
  it("parks the meeting off the queue until the booked day, without crediting the score", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    const snap = await adapter.load();
    const today = todayISO();
    // A household whose meeting is already due/overdue.
    const due = snap.dueDates.find((d) => d.type === "meeting" && d.dueDate <= today)!;
    const clientId = due.clientId;
    const meetingsBefore = snap.contactEvents.filter(
      (e) => e.clientId === clientId && e.type === "meeting",
    ).length;

    const booked = addDays(today, 20);
    let after = await adapter.updateClient(clientId, { nextMeetingDate: booked, nextMeetingNote: "Annual review" });
    after = await adapter.snoozeTouch(clientId, "meeting", booked);

    const client = after.clients.find((c) => c.id === clientId)!;
    expect(client.nextMeetingDate).toBe(booked);
    expect(client.nextMeetingNote).toBe("Annual review");
    // Off the queue until then...
    expect(after.tasks.some((t) => t.clientId === clientId && t.type === "meeting" && t.status === "open")).toBe(false);
    // ...but never counted as a meeting that happened.
    expect(after.contactEvents.filter((e) => e.clientId === clientId && e.type === "meeting").length).toBe(
      meetingsBefore,
    );
  });

  it("clears the booking once that meeting is logged, but keeps a later one", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    const snap = await adapter.load();
    const today = todayISO();
    const clientId = snap.clients[0].id;

    // Booked for today, then logged today → the booking is done.
    await adapter.updateClient(clientId, { nextMeetingDate: today, nextMeetingNote: "Review" });
    let after = await adapter.logContact({
      clientId, advisor: "matt", type: "meeting", eventDate: today, durationMinutes: 60, notes: null,
    });
    expect(after.clients.find((c) => c.id === clientId)!.nextMeetingDate).toBeNull();

    // A booking further out is a different appointment — logging today keeps it.
    const later = addDays(today, 45);
    await adapter.updateClient(clientId, { nextMeetingDate: later, nextMeetingNote: "Next one" });
    after = await adapter.logContact({
      clientId, advisor: "matt", type: "meeting", eventDate: today, durationMinutes: 60, notes: null,
    });
    expect(after.clients.find((c) => c.id === clientId)!.nextMeetingDate).toBe(later);
  });
});

// A joint review is one conversation with several households. Each keeps its
// own tier and its own clock, so each needs its own touch — otherwise the
// spouse you just spent an hour with still shows up overdue tomorrow.
describe("demo adapter — logging for the whole household", () => {
  const base = {
    assignedAdvisor: "matt" as const,
    phone: null,
    redtailId: null,
    revenue: 500_000,
    heldAway: false,
    heldAwayNote: null,
    tags: [],
    lastMeetingDate: null,
    lastCallDate: null,
  };

  /** A Tier S head and a Tier C child, deliberately NOT the same cadence. */
  async function mixedTierFamily() {
    const adapter = createDemoAdapter(memoryStorage());
    await adapter.load();
    const head = (await adapter.addClient({ ...base, householdName: "Kessler, Ann", tier: "S" }))
      .clients.find((c) => c.householdName === "Kessler, Ann")!;
    const child = (await adapter.addClient({ ...base, householdName: "Kessler, Ben", tier: "C" }))
      .clients.find((c) => c.householdName === "Kessler, Ben")!;
    await adapter.linkFamily([head.id, child.id], null, "Kessler Family");
    return { adapter, head, child };
  }

  it("writes one event per household, all sharing the same conversation", async () => {
    const { adapter, head, child } = await mixedTierFamily();
    const today = todayISO();

    const after = await adapter.logContact({
      clientId: head.id,
      advisor: "matt",
      type: "meeting",
      eventDate: today,
      durationMinutes: 60,
      notes: "Annual review, both of them at the table",
      alsoForClientIds: [child.id],
    });

    const logged = after.contactEvents.filter(
      (e) => e.eventDate === today && e.notes?.startsWith("Annual review"),
    );
    expect(logged.map((e) => e.clientId).sort()).toEqual([head.id, child.id].sort());
    expect(logged.every((e) => e.type === "meeting" && e.durationMinutes === 60)).toBe(true);
    // One conversation: same group id on both rows, and it is actually set.
    const groups = new Set(logged.map((e) => e.groupId));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBeTruthy();
  });

  it("rolls each household forward by its OWN tier's interval", async () => {
    const { adapter, head, child } = await mixedTierFamily();
    const today = todayISO();

    const after = await adapter.logContact({
      clientId: head.id, advisor: "matt", type: "meeting", eventDate: today,
      durationMinutes: 60, notes: null, alsoForClientIds: [child.id],
    });

    const interval = (tier: string) =>
      after.serviceModels.find((m) => m.tier === tier)!.meetingIntervalDays;
    const dueFor = (id: string) =>
      after.dueDates.find((d) => d.clientId === id && d.type === "meeting")!.dueDate;

    expect(interval("S")).not.toBe(interval("C")); // the fixture must stay mixed
    expect(dueFor(head.id)).toBe(addDays(today, interval("S")));
    expect(dueFor(child.id)).toBe(addDays(today, interval("C")));
  });

  it("settles the open task for every household, not just the one you picked", async () => {
    const { adapter, head, child } = await mixedTierFamily();
    const today = todayISO();

    const after = await adapter.logContact({
      clientId: head.id, advisor: "matt", type: "call", eventDate: today,
      durationMinutes: 15, notes: null, alsoForClientIds: [child.id],
    });

    for (const id of [head.id, child.id]) {
      expect(
        after.tasks.some((t) => t.clientId === id && t.type === "call" && t.status === "open"),
      ).toBe(false);
    }
  });

  it("leaves every household outside the family exactly where it was", async () => {
    const { adapter, head, child } = await mixedTierFamily();
    const before = await adapter.load();
    const outsiders = before.clients.filter((c) => c.id !== head.id && c.id !== child.id);
    const fingerprint = (snap: typeof before) =>
      outsiders
        .flatMap((c) => snap.dueDates.filter((d) => d.clientId === c.id))
        .map((d) => `${d.clientId}:${d.type}:${d.dueDate}`)
        .sort();

    const after = await adapter.logContact({
      clientId: head.id, advisor: "matt", type: "meeting", eventDate: todayISO(),
      durationMinutes: 60, notes: null, alsoForClientIds: [child.id],
    });

    expect(fingerprint(after)).toEqual(fingerprint(before));
    expect(after.contactEvents.filter((e) => !outsiders.some((c) => c.id === e.clientId)).length)
      .toBeGreaterThan(before.contactEvents.filter((e) => !outsiders.some((c) => c.id === e.clientId)).length);
  });

  it("moves only the one household when nothing is passed — the default is unchanged", async () => {
    const { adapter, head, child } = await mixedTierFamily();
    const before = await adapter.load();
    const childDueBefore = before.dueDates
      .filter((d) => d.clientId === child.id)
      .map((d) => `${d.type}:${d.dueDate}`)
      .sort();

    const after = await adapter.logContact({
      clientId: head.id, advisor: "matt", type: "meeting", eventDate: todayISO(),
      durationMinutes: 60, notes: null,
    });

    expect(
      after.dueDates.filter((d) => d.clientId === child.id).map((d) => `${d.type}:${d.dueDate}`).sort(),
    ).toEqual(childDueBefore);
    expect(after.contactEvents.filter((e) => e.clientId === child.id)).toHaveLength(0);
    // A single-household touch belongs to no group.
    expect(after.contactEvents.find((e) => e.clientId === head.id)!.groupId).toBeNull();
  });

  it("records an admin touch for everyone without moving anyone's clock", async () => {
    const { adapter, head, child } = await mixedTierFamily();
    const before = await adapter.load();
    const dueBefore = before.dueDates
      .filter((d) => d.clientId === head.id || d.clientId === child.id)
      .map((d) => `${d.clientId}:${d.type}:${d.dueDate}`)
      .sort();

    const after = await adapter.logContact({
      clientId: head.id, advisor: "matt", type: "admin", eventDate: todayISO(),
      durationMinutes: 5, notes: null, alsoForClientIds: [child.id],
    });

    const family = [head.id, child.id];
    expect(
      after.contactEvents.filter((e) => e.type === "admin" && family.includes(e.clientId)),
    ).toHaveLength(2);
    expect(
      after.dueDates
        .filter((d) => d.clientId === head.id || d.clientId === child.id)
        .map((d) => `${d.clientId}:${d.type}:${d.dueDate}`)
        .sort(),
    ).toEqual(dueBefore);
  });

  it("clears each household's booking on or before the day, and keeps later ones", async () => {
    const { adapter, head, child } = await mixedTierFamily();
    const today = todayISO();
    const later = addDays(today, 45);
    await adapter.updateClient(head.id, { nextMeetingDate: today, nextMeetingNote: "Joint review" });
    await adapter.updateClient(child.id, { nextMeetingDate: later, nextMeetingNote: "His own" });

    const after = await adapter.logContact({
      clientId: head.id, advisor: "matt", type: "meeting", eventDate: today,
      durationMinutes: 60, notes: null, alsoForClientIds: [child.id],
    });

    expect(after.clients.find((c) => c.id === head.id)!.nextMeetingDate).toBeNull();
    expect(after.clients.find((c) => c.id === child.id)!.nextMeetingDate).toBe(later);
  });

  it("ignores a household passed twice, and the initiating one passed again", async () => {
    const { adapter, head, child } = await mixedTierFamily();
    const after = await adapter.logContact({
      clientId: head.id, advisor: "matt", type: "call", eventDate: todayISO(),
      durationMinutes: 10, notes: "dedupe", alsoForClientIds: [child.id, child.id, head.id],
    });
    expect(after.contactEvents.filter((e) => e.notes === "dedupe")).toHaveLength(2);
  });

  it("refuses rather than half-logging when a household has gone away", async () => {
    const { adapter, head } = await mixedTierFamily();
    await expect(
      adapter.logContact({
        clientId: head.id, advisor: "matt", type: "call", eventDate: todayISO(),
        durationMinutes: 10, notes: null, alsoForClientIds: ["no-such-household"],
      }),
    ).rejects.toThrow(/no longer available/);
  });
});

describe("demo adapter — catching a family up on past touches", () => {
  const base = {
    assignedAdvisor: "matt" as const,
    phone: null,
    redtailId: null,
    revenue: 500_000,
    heldAway: false,
    heldAwayNote: null,
    tags: [],
    lastMeetingDate: null,
    lastCallDate: null,
  };

  async function familyWithBacklog() {
    const adapter = createDemoAdapter(memoryStorage());
    await adapter.load();
    const today = todayISO();
    const head = (await adapter.addClient({ ...base, householdName: "Osei, Ruth", tier: "S" }))
      .clients.find((c) => c.householdName === "Osei, Ruth")!;
    const spouse = (await adapter.addClient({ ...base, householdName: "Osei, Sam", tier: "C" }))
      .clients.find((c) => c.householdName === "Osei, Sam")!;
    await adapter.linkFamily([head.id, spouse.id], null, "Osei Family");
    // Two joint touches logged against Ruth only — the backlog this fixes.
    await adapter.logContact({
      clientId: head.id, advisor: "matt", type: "meeting",
      eventDate: addDays(today, -60), durationMinutes: 60, notes: "Review", 
    });
    await adapter.logContact({
      clientId: head.id, advisor: "matt", type: "call",
      eventDate: addDays(today, -20), durationMinutes: 15, notes: "Check-in",
    });
    return { adapter, head, spouse, today };
  }

  it("copies the missing touches onto the rest of the family", async () => {
    const { adapter, head, spouse } = await familyWithBacklog();
    const after = await adapter.catchUpHousehold(head.id);

    const his = after.contactEvents.filter((e) => e.clientId === spouse.id);
    expect(his.map((e) => e.type).sort()).toEqual(["call", "meeting"]);
    expect(his.map((e) => e.notes).sort()).toEqual(["Check-in", "Review"]);
  });

  it("ties each copy to the original, so one conversation counts once", async () => {
    const { adapter, head, spouse } = await familyWithBacklog();
    const after = await adapter.catchUpHousehold(head.id);

    const family = [head.id, spouse.id];
    for (const type of ["meeting", "call"] as const) {
      const pair = after.contactEvents.filter(
        (e) => e.type === type && family.includes(e.clientId),
      );
      expect(pair).toHaveLength(2);
      expect(pair[0].groupId).toBeTruthy();
      expect(pair[0].groupId).toBe(pair[1].groupId);
    }

  });

  it("rolls the caught-up household forward by its own tier", async () => {
    const { adapter, head, spouse, today } = await familyWithBacklog();
    const after = await adapter.catchUpHousehold(head.id);

    const interval = after.serviceModels.find((m) => m.tier === "C")!.callIntervalDays;
    const due = after.dueDates.find((d) => d.clientId === spouse.id && d.type === "call")!;
    expect(due.dueDate).toBe(addDays(addDays(today, -20), interval));
  });

  it("does nothing the second time — it is safe to press twice", async () => {
    const { adapter, head } = await familyWithBacklog();
    const once = await adapter.catchUpHousehold(head.id);
    const twice = await adapter.catchUpHousehold(head.id);
    expect(twice.contactEvents).toHaveLength(once.contactEvents.length);
  });

  it("does nothing for a household with no family", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    const before = await adapter.load();
    const solo = before.clients.find((c) => !c.familyId)!;
    const after = await adapter.catchUpHousehold(solo.id);
    expect(after.contactEvents).toHaveLength(before.contactEvents.length);
  });
});

// The standing rule: a family isn't always in the room together. A child or a
// trust can sit in the family without inheriting the parents' meetings.
describe("demo adapter — who a touch mirrors to", () => {
  const base = {
    assignedAdvisor: "matt" as const,
    phone: null,
    redtailId: null,
    revenue: 500_000,
    heldAway: false,
    heldAwayNote: null,
    tags: [],
    lastMeetingDate: null,
    lastCallDate: null,
  };

  async function familyOfThree() {
    const adapter = createDemoAdapter(memoryStorage());
    await adapter.load();
    const add = async (householdName: string, tier: "S" | "C") =>
      (await adapter.addClient({ ...base, householdName, tier })).clients.find(
        (c) => c.householdName === householdName,
      )!;
    const head = await add("Ferrand, Luc", "S");
    const spouse = await add("Ferrand, Noor", "S");
    const child = await add("Ferrand, Theo", "C");
    await adapter.linkFamily([head.id, spouse.id, child.id], null, "Ferrand Family");
    return { adapter, head, spouse, child };
  }

  it("has every member mirroring until you say otherwise", async () => {
    const { adapter } = await familyOfThree();
    const snap = await adapter.load();
    expect(snap.clients.every((c) => c.mirrorTouches)).toBe(true);
  });

  it("remembers the rule once it is turned off", async () => {
    const { adapter, child } = await familyOfThree();
    const after = await adapter.updateClient(child.id, { mirrorTouches: false });
    expect(after.clients.find((c) => c.id === child.id)!.mirrorTouches).toBe(false);
    // ...and back on again.
    const back = await adapter.updateClient(child.id, { mirrorTouches: true });
    expect(back.clients.find((c) => c.id === child.id)!.mirrorTouches).toBe(true);
  });

  it("is a default, not a lock — naming the member still logs for them", async () => {
    // This is the point of storing it on the client rather than enforcing it in
    // the adapter: "actually, Theo was there today" has to stay one tap.
    const { adapter, head, child } = await familyOfThree();
    await adapter.updateClient(child.id, { mirrorTouches: false });

    const after = await adapter.logContact({
      clientId: head.id,
      advisor: "matt",
      type: "meeting",
      eventDate: todayISO(),
      durationMinutes: 60,
      notes: "Theo came along",
      alsoForClientIds: [child.id],
    });

    expect(after.contactEvents.filter((e) => e.clientId === child.id)).toHaveLength(1);
  });

  it("leaves a non-mirroring member out of a catch-up", async () => {
    const { adapter, head, spouse, child } = await familyOfThree();
    const today = todayISO();
    await adapter.updateClient(child.id, { mirrorTouches: false });
    await adapter.logContact({
      clientId: head.id, advisor: "matt", type: "meeting",
      eventDate: addDays(today, -30), durationMinutes: 60, notes: "Just the parents",
    });

    const after = await adapter.catchUpHousehold(head.id);

    expect(after.contactEvents.filter((e) => e.clientId === spouse.id)).toHaveLength(1);
    expect(after.contactEvents.filter((e) => e.clientId === child.id)).toHaveLength(0);
  });

  it("catches nobody up when the whole rest of the family is ruled out", async () => {
    const { adapter, head, spouse, child } = await familyOfThree();
    const before = await adapter.load();
    await adapter.updateClient(spouse.id, { mirrorTouches: false });
    await adapter.updateClient(child.id, { mirrorTouches: false });
    await adapter.logContact({
      clientId: head.id, advisor: "matt", type: "call",
      eventDate: addDays(todayISO(), -10), durationMinutes: 15, notes: null,
    });

    const after = await adapter.catchUpHousehold(head.id);
    // Only the one call logged above — no copies anywhere.
    expect(after.contactEvents.length).toBe(before.contactEvents.length + 1);
  });
});

// Opportunity tags are config the firm owns, not a hardcoded list.
describe("demo adapter — the firm's own opportunity tags", () => {
  it("starts with the built-in set, Roth IRA included", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    const snap = await adapter.load();
    expect(snap.clientTags.length).toBeGreaterThan(0);
    expect(snap.clientTags.map((t) => t.id)).toContain("roth_conversion");
    expect(snap.clientTags.map((t) => t.id)).toContain("roth_ira");
  });

  it("adds a tag, deriving a stable id from the label", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    await adapter.load();
    const after = await adapter.addClientTag({
      label: "HSA Funding",
      keywords: ["HSA", " Health Savings "],
    });
    const tag = after.clientTags.find((t) => t.id === "hsa_funding");
    expect(tag).toBeDefined();
    expect(tag!.label).toBe("HSA Funding");
    // Stored lower-case and trimmed, because that is how they're matched.
    expect(tag!.keywords).toEqual(["hsa", "health savings"]);
  });

  it("refuses a duplicate name rather than shadowing the existing tag", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    await adapter.load();
    await expect(
      adapter.addClientTag({ label: "Roth Conversion", keywords: [] }),
    ).rejects.toThrow(/already a tag/);
  });

  it("refuses a name with nothing to slug", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    await adapter.load();
    await expect(adapter.addClientTag({ label: "   ", keywords: [] })).rejects.toThrow();
    await expect(adapter.addClientTag({ label: "!!!", keywords: [] })).rejects.toThrow(/letters/);
  });

  it("renaming keeps the id, so households keep the tag", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    const before = await adapter.load();
    const holder = before.clients.find((c) => c.tags.includes("roth_conversion"))!;
    expect(holder).toBeDefined();

    const after = await adapter.updateClientTag("roth_conversion", {
      label: "Roth Conversion Opportunity",
    });
    expect(after.clientTags.find((t) => t.id === "roth_conversion")!.label).toBe(
      "Roth Conversion Opportunity",
    );
    expect(after.clients.find((c) => c.id === holder.id)!.tags).toContain("roth_conversion");
  });

  it("edits the keywords a note listens for", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    await adapter.load();
    const after = await adapter.updateClientTag("rmd", { keywords: ["rmd", "distribution"] });
    expect(after.clientTags.find((t) => t.id === "rmd")!.keywords).toEqual(["rmd", "distribution"]);
  });

  it("deleting a tag takes it off every household carrying it", async () => {
    const adapter = createDemoAdapter(memoryStorage());
    const before = await adapter.load();
    const holders = before.clients.filter((c) => c.tags.includes("roth_conversion"));
    expect(holders.length).toBeGreaterThan(0);

    const after = await adapter.deleteClientTag("roth_conversion");
    expect(after.clientTags.some((t) => t.id === "roth_conversion")).toBe(false);
    // No household is left carrying an id with no definition behind it.
    expect(after.clients.every((c) => !c.tags.includes("roth_conversion"))).toBe(true);
    // ...and nothing else was disturbed.
    for (const h of holders) {
      const now = after.clients.find((c) => c.id === h.id)!;
      expect(now.tags).toEqual(h.tags.filter((t) => t !== "roth_conversion"));
    }
  });

  it("survives a snapshot saved before tags were data", async () => {
    // An advisor's browser still holds last week's localStorage. Without a
    // backfill, clientTags is undefined and the whole app throws on load.
    const storage = memoryStorage();
    const adapter = createDemoAdapter(storage);
    const seeded = await adapter.load();
    const stale = JSON.parse(storage.getItem("relationship-hub-demo-v1")!);
    delete stale.snapshot.clientTags;
    for (const c of stale.snapshot.clients) delete c.mirrorTouches;
    storage.setItem("relationship-hub-demo-v1", JSON.stringify(stale));

    const reopened = await createDemoAdapter(storage).load();
    expect(reopened.clientTags.length).toBe(seeded.clientTags.length);
    // mirrorTouches defaults on; left undefined it would read as "never mirror".
    expect(reopened.clients.every((c) => c.mirrorTouches === true)).toBe(true);
  });
});
