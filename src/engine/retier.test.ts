import { describe, expect, it } from "vitest";
import { planRetier } from "./retier";
import type { Client, ServiceModel } from "../types";

const MODELS: ServiceModel[] = [
  { tier: "S", meetingIntervalDays: 90, callIntervalDays: 30, minRevenue: 250000, description: null },
  { tier: "A", meetingIntervalDays: 90, callIntervalDays: 30, minRevenue: 100000, description: null },
  { tier: "B", meetingIntervalDays: 365, callIntervalDays: 90, minRevenue: 25000, description: null },
  { tier: "C", meetingIntervalDays: 365, callIntervalDays: 180, minRevenue: null, description: null },
];

let seq = 0;
const mk = (o: Partial<Client> = {}): Client => ({
  id: `c${seq++}`, householdName: `HH${seq}`, assignedAdvisor: "matt", tier: "C", active: true,
  phone: null, redtailId: null, revenue: null, heldAway: false, heldAwayNote: null,
  familyId: null, familyRole: null, createdAt: "", ...o,
});

describe("planRetier", () => {
  it("re-grades clients by their AUM against the saved floors", () => {
    const a = mk({ tier: "C", revenue: 150000 }); // → A
    const stay = mk({ tier: "B", revenue: 40000 }); // already B
    const s = mk({ tier: "A", revenue: 300000 }); // → S
    const changes = planRetier([a, stay, s], MODELS);
    expect(changes).toEqual([
      { clientId: a.id, householdName: a.householdName, fromTier: "C", toTier: "A" },
      { clientId: s.id, householdName: s.householdName, fromTier: "A", toTier: "S" },
    ]);
  });

  it("skips clients with no AUM and inactive clients", () => {
    const noAum = mk({ tier: "C", revenue: null });
    const inactive = mk({ tier: "C", revenue: 999999, active: false });
    expect(planRetier([noAum, inactive], MODELS)).toEqual([]);
  });

  it("grades family members on their combined assets", () => {
    // Two B-tier spouses, $150k + $150k = $300k → both should become S.
    const h1 = mk({ tier: "B", revenue: 150000, familyId: "f1" });
    const h2 = mk({ tier: "B", revenue: 150000, familyId: "f1" });
    const changes = planRetier([h1, h2], MODELS);
    expect(changes.map((c) => c.toTier)).toEqual(["S", "S"]);
  });
});
