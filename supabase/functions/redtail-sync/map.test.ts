import { describe, expect, it } from "vitest";
import { buildSyncPlan, parseContacts, type ExistingClient } from "./map";

describe("parseContacts", () => {
  it("reads the field spellings Redtail uses, preferring family name", () => {
    const { contacts } = parseContacts({
      contacts: [
        { ContactID: 101, Familyname: "Whitfield Household", Lastname: "Whitfield", Firstname: "Daniel", Status: "Active Client" },
        { contact_id: "102", last_name: "Okafor", first_name: "Samuel" },
        { id: 103, name: "Ramaswamy Family Trust" },
        { ID: 104, LastName: "Tran" },
      ],
    });
    expect(contacts.map((c) => [c.redtailId, c.householdName])).toEqual([
      ["101", "Whitfield Household"],
      ["102", "Okafor, Samuel"],
      ["103", "Ramaswamy Family Trust"],
      ["104", "Tran"],
    ]);
    expect(contacts[0].status).toBe("Active Client");
  });

  it("handles bare arrays, alternate wrappers, junk records, and dupes", () => {
    expect(parseContacts([{ Id: 1, Name: "Solo" }]).contacts).toHaveLength(1);
    expect(parseContacts({ Data: [{ Id: 1, Name: "Solo" }] }).contacts).toHaveLength(1);
    expect(parseContacts({ nothing: true }).contacts).toHaveLength(0);
    expect(parseContacts(null).contacts).toHaveLength(0);

    const { contacts, skippedNoName } = parseContacts({
      contacts: [
        { ContactID: 1, Lastname: "Kept" },
        { ContactID: 1, Lastname: "Duplicate" },
        { ContactID: 2 }, // no name
        "garbage",
      ],
    });
    expect(contacts).toHaveLength(1);
    expect(contacts[0].householdName).toBe("Kept");
    expect(skippedNoName).toBe(1);
  });
});

describe("buildSyncPlan", () => {
  const existing: ExistingClient[] = [
    { id: "a", household_name: "Whitfield Household", redtail_id: "101", active: true },
    { id: "b", household_name: "Okafor, Samuel", redtail_id: "102", active: true },
    { id: "c", household_name: "Beauchamp, Claire", redtail_id: null, active: true },
    { id: "d", household_name: "Gone Household", redtail_id: "109", active: true },
  ];

  const feed = parseContacts({
    contacts: [
      { ContactID: 101, Familyname: "Whitfield Household" }, // unchanged
      { ContactID: 102, Familyname: "Okafor-Adaeze Household" }, // renamed
      { ContactID: 103, Familyname: "beauchamp, claire" }, // relink by name
      { ContactID: 104, Familyname: "Brand New Household" }, // create
    ],
  }).contacts;

  it("classifies creates, renames, relinks, deactivations, unchanged", () => {
    const plan = buildSyncPlan(feed, existing);
    expect(plan.unchanged).toBe(1);
    expect(plan.renames).toEqual([
      { id: "b", from: "Okafor, Samuel", to: "Okafor-Adaeze Household", redtail_id: "102" },
    ]);
    expect(plan.relinks).toEqual([
      { id: "c", household_name: "Beauchamp, Claire", redtail_id: "103" },
    ]);
    expect(plan.creates).toEqual([{ redtail_id: "104", household_name: "Brand New Household" }]);
    expect(plan.deactivations).toEqual([
      { id: "d", household_name: "Gone Household", redtail_id: "109" },
    ]);
  });

  it("filters by status when configured, warning when nothing matches", () => {
    const withStatus = parseContacts({
      contacts: [
        { ContactID: 1, Name: "Client One", Status: "Active Client" },
        { ContactID: 2, Name: "Prospect Two", Status: "Prospect" },
      ],
    }).contacts;

    const plan = buildSyncPlan(withStatus, [], { statusFilter: "client" });
    expect(plan.creates.map((c) => c.household_name)).toEqual(["Client One"]);

    const none = buildSyncPlan(withStatus, [], { statusFilter: "zzz" });
    expect(none.creates).toHaveLength(0);
    expect(none.warnings[0]).toContain("matched none");
  });

  it("refuses mass deactivation when the feed looks like a partial fetch", () => {
    const book: ExistingClient[] = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      household_name: `Household ${i}`,
      redtail_id: String(200 + i),
      active: true,
    }));
    // Feed contains only 2 of the 10 linked households.
    const partial = parseContacts({
      contacts: [
        { ContactID: 200, Name: "Household 0" },
        { ContactID: 201, Name: "Household 1" },
      ],
    }).contacts;

    const plan = buildSyncPlan(partial, book);
    expect(plan.deactivations).toHaveLength(0);
    expect(plan.warnings.some((w) => w.includes("partial fetch"))).toBe(true);
  });

  it("never plans tier or advisor changes — those stay yours", () => {
    const plan = buildSyncPlan(feed, existing);
    const planned = JSON.stringify(plan);
    expect(planned).not.toContain("tier");
    expect(planned).not.toContain("advisor");
  });
});
