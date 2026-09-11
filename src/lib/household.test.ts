import { describe, expect, it } from "vitest";
import type { Client, ContactEvent } from "../types";
import {
  householdMembers,
  mirroringHouseholdMembers,
  otherHouseholdMembers,
  planHouseholdCatchUp,
} from "./household";

const TODAY = "2026-09-10";

let seq = 0;
function mkClient(overrides: Partial<Client> = {}): Client {
  seq += 1;
  return {
    id: `c${seq}`,
    householdName: `Household ${seq}`,
    assignedAdvisor: "matt",
    tier: "A",
    active: true,
    phone: null,
    redtailId: null,
    revenue: null,
    heldAway: false,
    heldAwayNote: null,
    familyId: null,
    familyRole: null,
    mirrorTouches: true,
    tags: [],
    nextMeetingDate: null,
    nextMeetingNote: null,
    createdAt: `${TODAY}T09:00:00.000Z`,
    ...overrides,
  };
}

function mkEvent(clientId: string, overrides: Partial<ContactEvent> = {}): ContactEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    clientId,
    advisor: "matt",
    type: "meeting",
    eventDate: TODAY,
    durationMinutes: 60,
    notes: null,
    groupId: null,
    createdAt: `${TODAY}T10:00:00.000Z`,
    ...overrides,
  };
}

describe("householdMembers", () => {
  it("returns just the client when it belongs to no family", () => {
    const solo = mkClient();
    const other = mkClient();
    expect(householdMembers([solo, other], solo).map((c) => c.id)).toEqual([solo.id]);
  });

  it("returns every member sharing the family id, the client included", () => {
    const a = mkClient({ familyId: "fam" });
    const b = mkClient({ familyId: "fam" });
    const outsider = mkClient({ familyId: "other-fam" });
    expect(householdMembers([a, b, outsider], a).map((c) => c.id)).toEqual([a.id, b.id]);
  });

  it("never treats two un-familied households as family", () => {
    // The bug this guards: null === null, so a missing guard would sweep in
    // every household in the book that happens to have no family either.
    const a = mkClient();
    const b = mkClient();
    expect(householdMembers([a, b], a)).toHaveLength(1);
    expect(otherHouseholdMembers([a, b], a)).toEqual([]);
  });
});

describe("otherHouseholdMembers", () => {
  it("excludes the client itself", () => {
    const a = mkClient({ familyId: "fam" });
    const b = mkClient({ familyId: "fam" });
    expect(otherHouseholdMembers([a, b], a).map((c) => c.id)).toEqual([b.id]);
  });

  it("leaves out archived members — their clock isn't running", () => {
    const a = mkClient({ familyId: "fam" });
    const gone = mkClient({ familyId: "fam", active: false });
    expect(otherHouseholdMembers([a, gone], a)).toEqual([]);
  });

  it("returns nothing for a family of one", () => {
    const only = mkClient({ familyId: "fam" });
    expect(otherHouseholdMembers([only], only)).toEqual([]);
  });
});

describe("mirroringHouseholdMembers", () => {
  it("leaves out the member whose standing rule is off", () => {
    const head = mkClient({ id: "head", familyId: "fam" });
    const spouse = mkClient({ id: "spouse", familyId: "fam" });
    const child = mkClient({ id: "child", familyId: "fam", mirrorTouches: false });
    const clients = [head, spouse, child];

    // The child is still a family member — Log Contact lists them, unticked.
    expect(otherHouseholdMembers(clients, head).map((c) => c.id)).toEqual(["spouse", "child"]);
    // ...but a touch does not land on them by default.
    expect(mirroringHouseholdMembers(clients, head).map((c) => c.id)).toEqual(["spouse"]);
  });

  it("still leaves out archived members, rule on or not", () => {
    const head = mkClient({ id: "head", familyId: "fam" });
    const gone = mkClient({ familyId: "fam", active: false, mirrorTouches: true });
    expect(mirroringHouseholdMembers([head, gone], head)).toEqual([]);
  });

  it("mirrors for everyone when no rule has been turned off", () => {
    const head = mkClient({ id: "head", familyId: "fam" });
    const spouse = mkClient({ id: "spouse", familyId: "fam" });
    expect(mirroringHouseholdMembers([head, spouse], head).map((c) => c.id)).toEqual(["spouse"]);
  });
});

describe("planHouseholdCatchUp", () => {
  const head = mkClient({ id: "head", familyId: "fam" });
  const spouse = mkClient({ id: "spouse", familyId: "fam" });
  const clients = [head, spouse];

  it("finds the touches the rest of the family is missing", () => {
    const events = [
      mkEvent("head", { type: "meeting", eventDate: "2026-06-01" }),
      mkEvent("head", { type: "call", eventDate: "2026-07-15" }),
    ];
    const plan = planHouseholdCatchUp(clients, events, head, TODAY);
    expect(plan.map((p) => `${p.source.type}:${p.source.eventDate}`)).toEqual([
      "meeting:2026-06-01",
      "call:2026-07-15",
    ]);
    expect(plan.every((p) => p.missing.map((m) => m.id).join() === "spouse")).toBe(true);
  });

  it("skips a touch the member already has on that date — so it is safe to run twice", () => {
    const events = [
      mkEvent("head", { type: "meeting", eventDate: "2026-06-01" }),
      mkEvent("spouse", { type: "meeting", eventDate: "2026-06-01" }),
    ];
    expect(planHouseholdCatchUp(clients, events, head, TODAY)).toEqual([]);
  });

  it("matches on type as well as date", () => {
    // The spouse has a call that day, not the meeting — still owed the meeting.
    const events = [
      mkEvent("head", { type: "meeting", eventDate: "2026-06-01" }),
      mkEvent("spouse", { type: "call", eventDate: "2026-06-01" }),
    ];
    const plan = planHouseholdCatchUp(clients, events, head, TODAY);
    expect(plan).toHaveLength(1);
    expect(plan[0].source.type).toBe("meeting");
  });

  it("copies only the touches that move a clock", () => {
    const events = [
      mkEvent("head", { type: "admin", eventDate: "2026-06-01" }),
      mkEvent("head", { type: "voicemail", eventDate: "2026-06-02" }),
    ];
    expect(planHouseholdCatchUp(clients, events, head, TODAY)).toEqual([]);
  });

  it("reaches back a year and no further", () => {
    const events = [
      mkEvent("head", { type: "meeting", eventDate: "2024-01-01" }),
      mkEvent("head", { type: "meeting", eventDate: "2026-08-01" }),
    ];
    const plan = planHouseholdCatchUp(clients, events, head, TODAY);
    expect(plan.map((p) => p.source.eventDate)).toEqual(["2026-08-01"]);
  });

  it("has nothing to do for a household with no family", () => {
    const solo = mkClient();
    const events = [mkEvent(solo.id, { type: "meeting", eventDate: "2026-06-01" })];
    expect(planHouseholdCatchUp([solo], events, solo, TODAY)).toEqual([]);
  });

  it("skips a member whose standing rule says not to mirror", () => {
    // A bulk copy is the last place to override a rule set deliberately.
    const child = mkClient({ id: "child", familyId: "fam", mirrorTouches: false });
    const events = [
      mkEvent("head", { type: "meeting", eventDate: "2026-06-01" }),
      mkEvent("spouse", { type: "meeting", eventDate: "2026-06-01" }),
    ];
    expect(planHouseholdCatchUp([...clients, child], events, head, TODAY)).toEqual([]);
  });

  it("reports each missing member separately in a family of three", () => {
    const third = mkClient({ id: "child", familyId: "fam" });
    const events = [
      mkEvent("head", { type: "meeting", eventDate: "2026-06-01" }),
      mkEvent("spouse", { type: "meeting", eventDate: "2026-06-01" }),
    ];
    const plan = planHouseholdCatchUp([...clients, third], events, head, TODAY);
    expect(plan).toHaveLength(1);
    expect(plan[0].missing.map((m) => m.id)).toEqual(["child"]);
  });
});
