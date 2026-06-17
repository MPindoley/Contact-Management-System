import { describe, expect, it } from "vitest";
import {
  buildImportPreview,
  distinctAdvisorValues,
  guessMapping,
  parseCsv,
  parseDateValue,
  parseRevenue,
  parseTier,
  tierFromCriteria,
  type ImportOptions,
} from "./importCsv";

const CRITERIA = [
  { tier: "S" as const, minRevenue: 250000 },
  { tier: "A" as const, minRevenue: 10000 },
  { tier: "B" as const, minRevenue: 4000 },
  { tier: "C" as const, minRevenue: null },
];

const baseOptions = (overrides: Partial<ImportOptions> = {}): ImportOptions => ({
  mapping: {},
  defaultAdvisor: "matt",
  defaultTier: "B",
  advisorValueMap: {},
  tierCriteria: null,
  existingClients: [],
  applyUpdates: true,
  ...overrides,
});

describe("parseCsv", () => {
  it("handles quoted fields, embedded commas, CRLF and BOM", () => {
    const text = '﻿Name,Advisor\r\n"Whitfield, Daniel & Mara",Matt\r\n"Says ""hi""",B\n';
    const csv = parseCsv(text);
    expect(csv.headers).toEqual(["Name", "Advisor"]);
    expect(csv.rows).toEqual([
      ["Whitfield, Daniel & Mara", "Matt"],
      ['Says "hi"', "B"],
    ]);
  });

  it("skips blank lines and handles empty input", () => {
    expect(parseCsv("").rows).toHaveLength(0);
    const csv = parseCsv("Name\n\nAlpha\n\n");
    expect(csv.rows).toEqual([["Alpha"]]);
  });
});

describe("guessMapping", () => {
  it("recognizes Redtail-style headers", () => {
    const m = guessMapping([
      "Household Name",
      "Assigned Advisor",
      "AUM",
      "Last Review Date",
      "Last Contact",
      "Redtail ID",
    ]);
    expect(m.householdName).toBe(0);
    expect(m.advisor).toBe(1);
    expect(m.revenue).toBe(2);
    expect(m.lastMeetingDate).toBe(3);
    expect(m.lastCallDate).toBe(4);
    expect(m.redtailId).toBe(5);
  });

  it("never assigns one column to two fields", () => {
    const m = guessMapping(["Name", "Tier"]);
    const used = Object.values(m);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe("value parsing", () => {
  it("parses revenue with currency formatting", () => {
    expect(parseRevenue("$1,250,000.50")).toBe(1250000.5);
    expect(parseRevenue(" 9200 ")).toBe(9200);
    expect(parseRevenue("n/a")).toBeNull();
    expect(parseRevenue("")).toBeNull();
  });

  it("parses tiers loosely", () => {
    expect(parseTier("A")).toBe("A");
    expect(parseTier("tier b")).toBe("B");
    expect(parseTier("C - legacy")).toBe("C");
    expect(parseTier("platinum")).toBeNull();
  });

  it("parses the date formats spreadsheets actually emit", () => {
    expect(parseDateValue("2026-06-12")).toBe("2026-06-12");
    expect(parseDateValue("6/3/2026")).toBe("2026-06-03");
    expect(parseDateValue("06/03/26")).toBe("2026-06-03");
    expect(parseDateValue("12-31-2025")).toBe("2025-12-31");
    expect(parseDateValue("2/30/2026")).toBeNull(); // not a real day
    expect(parseDateValue("soon")).toBeNull();
    expect(parseDateValue("")).toBeNull();
  });

  it("maps revenue to tiers using the saved criteria (S/A/B/C)", () => {
    expect(tierFromCriteria(300000, CRITERIA)).toBe("S");
    expect(tierFromCriteria(18500, CRITERIA)).toBe("A");
    expect(tierFromCriteria(10000, CRITERIA)).toBe("A");
    expect(tierFromCriteria(9200, CRITERIA)).toBe("B");
    expect(tierFromCriteria(2400, CRITERIA)).toBe("C");
  });
});

describe("buildImportPreview", () => {
  const csv = parseCsv(
    [
      "Household,Advisor,Revenue,Last Meeting,Last Call,ID",
      '"Whitfield, Daniel & Mara",Matt,18500,3/14/2026,5/28/2026,48200',
      "Castellanos Family,Advisor B,9200,1/9/2026,4/2/2026,48237",
      '"Abernathy, Gordon",Both,2400,11/20/2025,bad-date,48274',
      ",Matt,5000,,,",
      "Castellanos Family,Matt,1,,,99999",
    ].join("\n"),
  );

  const options = baseOptions({
    mapping: {
      householdName: 0,
      advisor: 1,
      revenue: 2,
      lastMeetingDate: 3,
      lastCallDate: 4,
      redtailId: 5,
    },
    advisorValueMap: { matt: "matt", "advisor b": "advisor_b", both: "joint" },
    tierCriteria: CRITERIA,
  });

  it("resolves tiers, advisors, dates; counts and flags problems", () => {
    const preview = buildImportPreview(csv, options);

    expect(preview.skippedNoName).toBe(1);
    expect(preview.newCount).toBe(3);
    expect(preview.duplicateCount).toBe(1); // Castellanos repeated in-file
    expect(preview.tierCounts).toEqual({ S: 0, A: 1, B: 1, C: 1 });

    const whitfield = preview.rows.find((r) => r.householdName.startsWith("Whitfield"))!;
    expect(whitfield.input).toMatchObject({
      assignedAdvisor: "matt",
      tier: "A",
      lastMeetingDate: "2026-03-14",
      lastCallDate: "2026-05-28",
      redtailId: "48200",
    });

    const abernathy = preview.rows.find((r) => r.householdName.startsWith("Abernathy"))!;
    expect(abernathy.input!.assignedAdvisor).toBe("joint");
    expect(abernathy.input!.tier).toBe("C");
    expect(abernathy.input!.lastCallDate).toBeNull();
    expect(abernathy.warnings.some((w) => w.includes("bad-date"))).toBe(true);
  });

  it("updates an existing household when the CSV differs, history untouched", () => {
    const preview = buildImportPreview(
      csv,
      baseOptions({
        mapping: options.mapping,
        advisorValueMap: options.advisorValueMap,
        tierCriteria: options.tierCriteria,
        existingClients: [
          // Whitfield exists at Tier C with no phone → should update to A.
          { id: "x1", householdName: "Whitfield, Daniel & Mara", tier: "C", assignedAdvisor: "matt", phone: null, redtailId: "48200", revenue: null, heldAway: false },
          // Castellanos already Tier B / Beau / same AUM → matches → unchanged.
          { id: "x2", householdName: "Castellanos Family", tier: "B", assignedAdvisor: "advisor_b", phone: null, redtailId: "48237", revenue: 9200, heldAway: false },
        ],
      }),
    );

    expect(preview.newCount).toBe(1); // only Abernathy is new now
    expect(preview.updateCount).toBe(1); // Whitfield
    expect(preview.unchangedCount).toBe(1); // Castellanos (first occurrence)
    expect(preview.duplicateCount).toBe(1); // Castellanos second occurrence

    const whitfield = preview.rows.find((r) => r.householdName.startsWith("Whitfield"))!;
    expect(whitfield.status).toBe("update");
    expect(whitfield.existingId).toBe("x1");
    expect(whitfield.patch).toEqual({ tier: "A", revenue: 18500 });
    expect(whitfield.changes).toContain("Tier C → A");
    // Crucially, an update carries no contact-history seeding.
    expect(whitfield.input).toBeUndefined();
  });

  it("does not touch fields the CSV doesn't explicitly specify", () => {
    // No tier or revenue column → tier is a default, so it must NOT overwrite.
    const tiny = parseCsv("Name,Phone\nExisting Household,(419) 555-1212");
    const preview = buildImportPreview(
      tiny,
      baseOptions({
        mapping: { householdName: 0, phone: 1 },
        existingClients: [
          { id: "e1", householdName: "Existing Household", tier: "A", assignedAdvisor: "advisor_b", phone: null, redtailId: null, revenue: null, heldAway: false },
        ],
      }),
    );
    const row = preview.rows[0];
    expect(row.status).toBe("update");
    expect(row.patch).toEqual({ phone: "(419) 555-1212" }); // phone only; tier A preserved
    expect(row.changes).toEqual(["Phone added"]);
  });

  it("respects applyUpdates=false (matched rows become unchanged)", () => {
    const tiny = parseCsv("Name,Tier\nExisting Household,A");
    const preview = buildImportPreview(
      tiny,
      baseOptions({
        mapping: { householdName: 0, tier: 1 },
        applyUpdates: false,
        existingClients: [
          { id: "e1", householdName: "Existing Household", tier: "C", assignedAdvisor: "matt", phone: null, redtailId: null, revenue: null, heldAway: false },
        ],
      }),
    );
    expect(preview.updateCount).toBe(0);
    expect(preview.unchangedCount).toBe(1);
    expect(preview.rows[0].patch).toBeUndefined();
  });

  it("falls back to defaults when nothing decides tier or advisor", () => {
    const tiny = parseCsv("Name\nSolo Household");
    const preview = buildImportPreview(tiny, baseOptions({ mapping: { householdName: 0 } }));
    expect(preview.rows[0].input!.tier).toBe("B");
    expect(preview.rows[0].input!.assignedAdvisor).toBe("matt");
    expect(preview.rows[0].input!.lastMeetingDate).toBeNull();
  });

  it("lists distinct advisor values for the mapping UI", () => {
    expect(distinctAdvisorValues(csv, options.mapping)).toEqual(["Matt", "Advisor B", "Both"]);
  });
});
