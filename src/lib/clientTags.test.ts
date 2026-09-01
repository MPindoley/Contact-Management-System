import { describe, expect, it } from "vitest";
import { CLIENT_TAGS, CLIENT_TAG_LABELS, clientMatchesTagSearch, type ClientTag } from "../types";

describe("client opportunity tags", () => {
  it("every tag has a label", () => {
    expect(CLIENT_TAGS.length).toBeGreaterThan(0);
    for (const t of CLIENT_TAGS) expect(CLIENT_TAG_LABELS[t]).toBeTruthy();
  });

  it("matches a partial, case-insensitive tag search", () => {
    const tags: ClientTag[] = ["roth_conversion", "side_fund"];
    expect(clientMatchesTagSearch(tags, "roth")).toBe(true);
    expect(clientMatchesTagSearch(tags, "ROTH conversion")).toBe(true);
    expect(clientMatchesTagSearch(tags, "side")).toBe(true);
  });

  it("does not match tags the household doesn't have", () => {
    expect(clientMatchesTagSearch(["roth_conversion"], "long-term care")).toBe(false);
    expect(clientMatchesTagSearch([], "roth")).toBe(false);
  });

  it("an empty search never matches on tags alone", () => {
    expect(clientMatchesTagSearch(["roth_conversion"], "   ")).toBe(false);
  });

  it("finds long-term care and money due by their words", () => {
    expect(clientMatchesTagSearch(["ltc_insurance"], "care")).toBe(true);
    expect(clientMatchesTagSearch(["money_due"], "money")).toBe(true);
  });
});
