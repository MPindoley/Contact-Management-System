import { describe, expect, it } from "vitest";
import { planSurnameLinks } from "./familyLink";
import type { AdvisorAssignment, Client } from "../types";

function client(
  id: string,
  householdName: string,
  assignedAdvisor: AdvisorAssignment,
  extra: Partial<Client> = {},
): Client {
  return {
    id,
    householdName,
    assignedAdvisor,
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
    ...extra,
  };
}

describe("planSurnameLinks", () => {
  it("groups same-surname households within one book", () => {
    const groups = planSurnameLinks([
      client("1", "Whitfield, Dan", "matt"),
      client("2", "Whitfield, Mara", "matt"),
      client("3", "Okafor, Sam", "matt"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].surname).toBe("Whitfield");
    expect(groups[0].advisor).toBe("matt");
    expect(groups[0].clients.map((c) => c.id).sort()).toEqual(["1", "2"]);
  });

  it("never merges the same surname across different books", () => {
    const groups = planSurnameLinks([
      client("1", "Nguyen, Anh", "matt"),
      client("2", "Nguyen, Bao", "advisor_b"), // different advisor — unrelated
    ]);
    // Two singletons in different books → nothing to link.
    expect(groups).toHaveLength(0);
  });

  it("groups each book separately when surnames coincide across books", () => {
    const groups = planSurnameLinks([
      client("1", "Nguyen, Anh", "matt"),
      client("2", "Nguyen, Bao", "matt"),
      client("3", "Nguyen, Cuc", "advisor_b"),
      client("4", "Nguyen, Dat", "advisor_b"),
    ]);
    expect(groups).toHaveLength(2);
    const byAdvisor = Object.fromEntries(groups.map((g) => [g.advisor, g.clients.map((c) => c.id).sort()]));
    expect(byAdvisor.matt).toEqual(["1", "2"]);
    expect(byAdvisor.advisor_b).toEqual(["3", "4"]);
  });

  it("skips already-linked and inactive households", () => {
    const groups = planSurnameLinks([
      client("1", "Park, A", "matt", { familyId: "fam_existing" }),
      client("2", "Park, B", "matt"),
      client("3", "Park, C", "matt", { active: false }),
    ]);
    // Only one eligible "Park" left (id 2) → no group.
    expect(groups).toHaveLength(0);
  });

  it("can scope to a single book via opts.advisor", () => {
    const groups = planSurnameLinks(
      [
        client("1", "Park, A", "matt"),
        client("2", "Park, B", "matt"),
        client("3", "Park, C", "joint"),
        client("4", "Park, D", "joint"),
      ],
      { advisor: "joint" },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].advisor).toBe("joint");
    expect(groups[0].clients.map((c) => c.id).sort()).toEqual(["3", "4"]);
  });
});
