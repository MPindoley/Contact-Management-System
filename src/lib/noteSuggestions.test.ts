import { describe, expect, it } from "vitest";
import { suggestFromNote, suggestMeetingDate, suggestTags } from "./noteSuggestions";

const TODAY = "2026-09-01"; // a Tuesday

describe("suggestTags", () => {
  it("picks the opportunity out of a dictated note", () => {
    expect(suggestTags("Talked through a Roth conversion before year end")).toEqual([
      "roth_conversion",
    ]);
    expect(suggestTags("She asked about long-term care coverage for her mother")).toEqual([
      "ltc_insurance",
    ]);
    expect(suggestTags("He has an old 401k still sitting at Fidelity")).toEqual(["money_due"]);
  });

  it("finds several in one note, in a stable order", () => {
    const note =
      "Went over the Roth conversion, he wants to fund the 529 for the grandkids, and we should review the annuity.";
    expect(suggestTags(note)).toEqual(["roth_conversion", "college_529", "annuity_review"]);
  });

  it("never suggests a tag the household already has", () => {
    expect(suggestTags("Roth conversion again", ["roth_conversion"])).toEqual([]);
  });

  it("matches on word boundaries, so it doesn't fire on lookalikes", () => {
    // "rmd" inside another word, "529" inside a longer number
    expect(suggestTags("Account 15290 transferred, ref rmdx9")).toEqual([]);
  });

  it("returns nothing for an empty or chatty note", () => {
    expect(suggestTags("")).toEqual([]);
    expect(suggestTags("Nice catch-up, kids are doing well.")).toEqual([]);
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
    const s = suggestFromNote(note, [], TODAY);
    expect(s.tags).toEqual(["roth_conversion", "college_529"]);
    expect(s.meetingDate).toBe("2026-10-15");
    expect(s.meetingPhrase).toBe("the fall");
  });
});
