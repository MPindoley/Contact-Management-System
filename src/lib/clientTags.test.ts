import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLIENT_TAGS,
  clientMatchesTagSearch,
  slugifyTag,
  sortedTags,
  tagLabel,
  type ClientTag,
  type ClientTagDef,
} from "../types";

const DEFS = DEFAULT_CLIENT_TAGS;

describe("the tags a firm starts with", () => {
  it("every default has a label and a unique id", () => {
    expect(DEFS.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const t of DEFS) {
      expect(t.label).toBeTruthy();
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }
  });

  it("keeps the ids households already store", () => {
    // These are written into clients.tags on the live database. Renaming one
    // would silently orphan every household carrying it.
    for (const id of ["roth_conversion", "side_fund", "ltc_insurance", "money_due", "rmd"]) {
      expect(DEFS.some((t) => t.id === id)).toBe(true);
    }
  });

  it("keywords are stored lower-case, since that is how they are matched", () => {
    for (const t of DEFS) {
      for (const k of t.keywords) expect(k).toBe(k.toLowerCase());
    }
  });
});

describe("sortedTags", () => {
  it("orders by sortOrder", () => {
    const defs: ClientTagDef[] = [
      { id: "c", label: "C", keywords: [], sortOrder: 2 },
      { id: "a", label: "A", keywords: [], sortOrder: 0 },
      { id: "b", label: "B", keywords: [], sortOrder: 1 },
    ];
    expect(sortedTags(defs).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("falls back to the label when two share an order", () => {
    const defs: ClientTagDef[] = [
      { id: "z", label: "Zebra", keywords: [], sortOrder: 0 },
      { id: "a", label: "Apple", keywords: [], sortOrder: 0 },
    ];
    expect(sortedTags(defs).map((t) => t.id)).toEqual(["a", "z"]);
  });

  it("does not mutate what it is given", () => {
    const defs: ClientTagDef[] = [
      { id: "b", label: "B", keywords: [], sortOrder: 1 },
      { id: "a", label: "A", keywords: [], sortOrder: 0 },
    ];
    sortedTags(defs);
    expect(defs.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("tagLabel", () => {
  it("uses the definition when there is one", () => {
    expect(tagLabel(DEFS, "roth_ira")).toBe("Roth IRA");
  });

  it("humanises an id whose definition is gone rather than rendering blank", () => {
    // Deleting a tag on one device leaves the id on a household until that
    // device syncs. Showing something recognisable beats showing nothing.
    expect(tagLabel(DEFS, "some_removed_tag")).toBe("Some Removed Tag");
    expect(tagLabel([], "rmd")).toBe("Rmd");
  });
});

describe("slugifyTag", () => {
  it("turns a label into a stable id", () => {
    expect(slugifyTag("Roth IRA")).toBe("roth_ira");
    expect(slugifyTag("529 / College Funding")).toBe("529_college_funding");
    expect(slugifyTag("  Long-Term Care  ")).toBe("long_term_care");
  });

  it("reproduces the ids of the tags that already exist", () => {
    expect(slugifyTag("Roth Conversion")).toBe("roth_conversion");
    expect(slugifyTag("Side Fund")).toBe("side_fund");
  });

  it("returns empty for a label with nothing to slug", () => {
    expect(slugifyTag("!!!")).toBe("");
    expect(slugifyTag("   ")).toBe("");
  });
});

describe("clientMatchesTagSearch", () => {
  it("matches a partial, case-insensitive tag search", () => {
    const tags: ClientTag[] = ["roth_conversion", "side_fund"];
    expect(clientMatchesTagSearch(tags, "roth", DEFS)).toBe(true);
    expect(clientMatchesTagSearch(tags, "ROTH conversion", DEFS)).toBe(true);
    expect(clientMatchesTagSearch(tags, "side", DEFS)).toBe(true);
  });

  it("finds a tag the firm added itself", () => {
    const defs = [...DEFS, { id: "hsa", label: "HSA Funding", keywords: [], sortOrder: 11 }];
    expect(clientMatchesTagSearch(["hsa"], "hsa", defs)).toBe(true);
    expect(clientMatchesTagSearch(["hsa"], "funding", defs)).toBe(true);
  });

  it("does not match tags the household doesn't have", () => {
    expect(clientMatchesTagSearch(["roth_conversion"], "long-term care", DEFS)).toBe(false);
    expect(clientMatchesTagSearch([], "roth", DEFS)).toBe(false);
  });

  it("an empty search never matches on tags alone", () => {
    expect(clientMatchesTagSearch(["roth_conversion"], "   ", DEFS)).toBe(false);
  });

  it("finds long-term care and money due by their words", () => {
    expect(clientMatchesTagSearch(["ltc_insurance"], "care", DEFS)).toBe(true);
    expect(clientMatchesTagSearch(["money_due"], "money", DEFS)).toBe(true);
  });

  it("searching 'roth ira' at year end finds the households to call", () => {
    // The whole point of the Roth IRA tag: find everyone who may still have
    // room to contribute before the deadline.
    expect(clientMatchesTagSearch(["roth_ira"], "roth ira", DEFS)).toBe(true);
    expect(clientMatchesTagSearch(["roth_conversion"], "roth ira", DEFS)).toBe(false);
  });
});
