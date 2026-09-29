import { describe, expect, it } from "vitest";
import { suggestFromNote, suggestMeetingDate, suggestTags } from "./noteSuggestions";
import { DEFAULT_CLIENT_TAGS } from "../types";

const DEFS = DEFAULT_CLIENT_TAGS;

const TODAY = "2026-09-01"; // a Tuesday

describe("suggestTags", () => {
  it("picks the opportunity out of a dictated note", () => {
    expect(suggestTags("Talked through a Roth conversion before year end", [], DEFS)).toEqual([
      "roth_conversion",
    ]);
    expect(suggestTags("She asked about long-term care coverage for her mother", [], DEFS)).toEqual([
      "ltc_insurance",
    ]);
    expect(suggestTags("He has an old 401k still sitting at Fidelity", [], DEFS)).toEqual(["money_due"]);
  });

  it("finds several in one note, in a stable order", () => {
    const note =
      "Went over the Roth conversion, he wants to fund the 529 for the grandkids, and we should review the annuity.";
    expect(suggestTags(note, [], DEFS)).toEqual(["roth_conversion", "college_529", "annuity_review"]);
  });

  it("never suggests a tag the household already has", () => {
    expect(suggestTags("Roth conversion again", ["roth_conversion"], DEFS)).toEqual([]);
  });

  it("matches on word boundaries, so it doesn't fire on lookalikes", () => {
    // "rmd" inside another word, "529" inside a longer number
    expect(suggestTags("Account 15290 transferred, ref rmdx9", [], DEFS)).toEqual([]);
  });

  it("suggests a tag the firm added itself", () => {
    // The whole point: no code change to teach the note reader a new word.
    const defs = [
      ...DEFS,
      { id: "hsa", label: "HSA Funding", keywords: ["hsa", "health savings"], sortOrder: 11 },
    ];
    expect(suggestTags("Wants to max the HSA this year", [], defs)).toEqual(["hsa"]);
    expect(suggestTags("opened a health savings account", [], defs)).toEqual(["hsa"]);
  });

  it("a tag with no keywords is never suggested", () => {
    const defs = [{ id: "manual", label: "Manual Only", keywords: [], sortOrder: 0 }];
    expect(suggestTags("manual only manual", [], defs)).toEqual([]);
  });

  describe("overlapping keywords", () => {
    // "Roth IRA" owns a bare "roth"; "Roth Conversion" owns the longer phrase.
    // Without a rule, every conversion note would drag the IRA tag in with it.
    it("the more specific tag wins when one phrase contains the other", () => {
      expect(suggestTags("Went through the roth conversion", [], DEFS)).toEqual([
        "roth_conversion",
      ]);
    });

    it("the broader tag still fires on its own", () => {
      expect(suggestTags("He still has room in the roth this year", [], DEFS)).toEqual(["roth_ira"]);
      expect(suggestTags("max out the roth before April", [], DEFS)).toEqual(["roth_ira"]);
    });

    it("both fire when the note genuinely means both", () => {
      const tags = suggestTags(
        "Did the roth conversion, and she can still make a roth ira contribution.",
        [],
        DEFS,
      );
      expect(tags).toContain("roth_conversion");
      expect(tags).toContain("roth_ira");
    });

    it("shadowing does not depend on what the household already has", () => {
      // Already tagged Roth Conversion: the note still must not offer Roth IRA
      // off the bare "roth" inside "roth conversion".
      expect(suggestTags("Roth conversion again", ["roth_conversion"], DEFS)).toEqual([]);
    });
  });

  it("returns nothing for an empty or chatty note", () => {
    expect(suggestTags("", [], DEFS)).toEqual([]);
    expect(suggestTags("Nice catch-up, kids are doing well.", [], DEFS)).toEqual([]);
  });
});

describe("suggestMeetingDate", () => {
  it("handles 'in N weeks/months'", () => {
    expect(suggestMeetingDate("follow up in 3 weeks", TODAY)?.date).toBe("2026-09-22");
    expect(suggestMeetingDate("see them in two months", TODAY)?.date).toBe("2026-10-31");
  });

  it("handles 'next month' and friends", () => {
    expect(suggestMeetingDate("book them next month", TODAY)?.date).toBe("2026-10-01");
    expect(suggestMeetingDate("circle back next quarter", TODAY)?.date).toBe("2026-12-01");
  });

  it("handles a named month, and always picks the next one", () => {
    expect(suggestMeetingDate("get them on the calendar for October", TODAY)?.date).toBe("2026-10-15");
    expect(suggestMeetingDate("early October works", TODAY)?.date).toBe("2026-10-05");
    // March has already passed this year → next year's March
    expect(suggestMeetingDate("let's meet in March", TODAY)?.date).toBe("2027-03-15");
  });

  it("understands the planning seasons and year-end", () => {
    expect(suggestMeetingDate("revisit in the fall", TODAY)?.date).toBe("2026-10-15");
    expect(suggestMeetingDate("before year-end", TODAY)?.date).toBe("2026-12-15");
  });

  it("reports the phrase it matched, so the advisor can check it", () => {
    expect(suggestMeetingDate("follow up in 3 weeks", TODAY)?.phrase).toBe("in 3 weeks");
  });

  it("returns nothing when no date is implied", () => {
    expect(suggestMeetingDate("Good conversation, nothing outstanding.", TODAY)).toBeNull();
  });
});

describe("suggestFromNote", () => {
  it("reads a realistic dictated note end to end", () => {
    const note =
      "Just met the Whitfields. Went through the Roth conversion, they want to revisit in the fall. " +
      "Send the 529 illustration.";
    const s = suggestFromNote(note, [], TODAY, DEFS);
    expect(s.tags).toEqual(["roth_conversion", "college_529"]);
    expect(s.meetingDate).toBe("2026-10-15");
    expect(s.meetingPhrase).toBe("the fall");
  });
});
