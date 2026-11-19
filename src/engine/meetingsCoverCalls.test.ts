// "If I meet with them twice in the year, that fulfils the call requirement."
// The rule, pinned from every side: the cover itself, the stored call due date,
// snoozes, the score, the rollups and the pace target.

import { describe, expect, it } from "vitest";
import {
  callCover,
  clientScore,
  computeClientDueDates,
  coverThreshold,
  coveredAnnualTouches,
  monthlyProgress,
  rollupScore,
} from "./serviceEngine";
import { addDays } from "../lib/dates";
import type { Client, ContactEvent, DueDate, ServiceModel } from "../types";

const TODAY = "2026-06-11";

// The demo cadences, with the rule on for every tier — the owner's default.
const MODELS: ServiceModel[] = [
  { tier: "S", meetingIntervalDays: 90, callIntervalDays: 30, minRevenue: null, description: null, meetingsCoverCalls: 2 },
  { tier: "A", meetingIntervalDays: 90, callIntervalDays: 30, minRevenue: null, description: null, meetingsCoverCalls: 2 },
  { tier: "B", meetingIntervalDays: 365, callIntervalDays: 90, minRevenue: null, description: null, meetingsCoverCalls: 2 },
  { tier: "C", meetingIntervalDays: 365, callIntervalDays: 180, minRevenue: null, description: null, meetingsCoverCalls: 2 },
];
const model = (tier: string) => MODELS.find((m) => m.tier === tier)!;
const withCover = (tier: string, n: number | null | undefined): ServiceModel[] =>
  MODELS.map((m) => (m.tier === tier ? { ...m, meetingsCoverCalls: n } : m));

let seq = 0;
function mkClient(overrides: Partial<Client> = {}): Client {
  seq += 1;
  return {
    id: `client-${seq}`,
    householdName: `Household ${seq}`,
    assignedAdvisor: "matt",
    tier: "B",
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
    createdAt: "2023-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A touch logged on the day it happened, unless the test says otherwise. */
function touch(clientId: string, type: ContactEvent["type"], eventDate: string, overrides: Partial<ContactEvent> = {}): ContactEvent {
  seq += 1;
  return {
    id: `event-${String(seq).padStart(4, "0")}`,
    clientId,
    advisor: "matt",
    type,
    eventDate,
    durationMinutes: null,
    notes: null,
    groupId: null,
    createdAt: `${eventDate}T15:00:00.000Z`,
    ...overrides,
  };
}

const callRow = (rows: DueDate[]) => rows.find((r) => r.type === "call");
const meetingRow = (rows: DueDate[]) => rows.find((r) => r.type === "meeting");

describe("coverThreshold", () => {
  it("reads 2 as on", () => {
    expect(coverThreshold(model("B"))).toBe(2);
  });

  it("treats off, missing and nonsense the same way: off", () => {
    // undefined = the database predates the setting (migration 0013 not run).
    for (const n of [null, undefined, 0, 1, 2.5, 13, -2]) {
      expect(coverThreshold({ ...model("B"), meetingsCoverCalls: n as number | null | undefined })).toBeNull();
    }
  });
});

describe("callCover", () => {
  const c = mkClient();

  it("needs two meetings on two different days", () => {
    expect(callCover(c.id, [touch(c.id, "meeting", "2026-03-01")], model("B"))).toBeNull();
    const both = [touch(c.id, "meeting", "2026-03-01"), touch(c.id, "meeting", "2026-05-01")];
    expect(callCover(c.id, both, model("B"))).not.toBeNull();
  });

  it("counts one sit-down logged twice as one meeting", () => {
    // A double log, or Matt and Beau both logging the same meeting.
    const twiceSameDay = [touch(c.id, "meeting", "2026-03-01"), touch(c.id, "meeting", "2026-03-01")];
    expect(callCover(c.id, twiceSameDay, model("B"))).toBeNull();
  });

  it("lasts until the older of the two meetings is a year old", () => {
    const older = touch(c.id, "meeting", "2025-11-23");
    const newer = touch(c.id, "meeting", "2026-05-22");
    const cover = callCover(c.id, [older, newer], model("B"))!;
    expect(cover.endsOn).toBe(addDays("2025-11-23", 365));
    expect(cover.sourceEventId).toBe(older.id);
    expect(cover.meetingDates).toEqual(["2026-05-22", "2025-11-23"]);
  });

  it("uses the two most recent meetings, not the first two ever", () => {
    const events = ["2024-01-10", "2025-06-01", "2026-02-01", "2026-05-01"].map((d) =>
      touch(c.id, "meeting", d),
    );
    expect(callCover(c.id, events, model("B"))!.endsOn).toBe(addDays("2026-02-01", 365));
  });

  it("needs the meetings within a year of each other", () => {
    // March 2025 and May 2026 were never "two in a year".
    const apart = ["2025-03-01", "2026-05-01"].map((d) => touch(c.id, "meeting", d));
    expect(callCover(c.id, apart, model("B"))).toBeNull();
    // 365 days apart is a day too many: the older one's year is over by the
    // day of the newer. 364 days apart covers, for exactly one day.
    const yearApart = ["2025-05-01", "2026-05-01"].map((d) => touch(c.id, "meeting", d));
    expect(callCover(c.id, yearApart, model("B"))).toBeNull();
    const justInside = ["2025-05-02", "2026-05-01"].map((d) => touch(c.id, "meeting", d));
    expect(callCover(c.id, justInside, model("B"))!.endsOn).toBe("2026-05-02");
  });

  it("falls back to the latest pair that did fit, when the newest two don't", () => {
    // Covered by March + June 2025 until March 2026. A meeting in November
    // 2026 is too far from June 2025 to pair with it, so the cover still ran
    // out in March 2026.
    const events = ["2025-03-01", "2025-06-01", "2026-11-19"].map((d) => touch(c.id, "meeting", d));
    const cover = callCover(c.id, events, model("B"))!;
    expect(cover.endsOn).toBe(addDays("2025-03-01", 365));
    expect(cover.sourceEventId).toBe(events[0].id);
    expect(cover.meetingDates).toEqual(["2025-06-01", "2025-03-01"]);
  });

  it("ignores calls, voicemails and admin touches", () => {
    const events = [
      touch(c.id, "meeting", "2026-03-01"),
      touch(c.id, "call", "2026-04-01"),
      touch(c.id, "voicemail", "2026-04-15"),
      touch(c.id, "admin", "2026-05-01"),
    ];
    expect(callCover(c.id, events, model("B"))).toBeNull();
  });

  it("ignores another household's meetings", () => {
    const other = mkClient();
    const events = [touch(c.id, "meeting", "2026-03-01"), touch(other.id, "meeting", "2026-05-01")];
    expect(callCover(c.id, events, model("B"))).toBeNull();
  });

  it("won't let a meeting dated after the day it was logged count", () => {
    // The CSV importer will take a typo like 11/10/27. One future meeting must
    // not quietly switch a household's calls off for a year.
    const typo = touch(c.id, "meeting", "2027-11-10", { createdAt: "2026-06-01T15:00:00.000Z" });
    const real = touch(c.id, "meeting", "2026-06-01");
    expect(callCover(c.id, [typo, real], model("B"))).toBeNull();
  });

  it("does count a meeting logged after the fact", () => {
    const backfilled = touch(c.id, "meeting", "2026-01-15", { createdAt: "2026-06-01T15:00:00.000Z" });
    const real = touch(c.id, "meeting", "2026-05-01");
    expect(callCover(c.id, [backfilled, real], model("B"))).not.toBeNull();
  });

  it("honours a higher threshold", () => {
    const three = withCover("B", 3);
    const two = ["2026-02-01", "2026-04-01"].map((d) => touch(c.id, "meeting", d));
    expect(callCover(c.id, two, model("B"))).not.toBeNull();
    expect(callCover(c.id, two, three.find((m) => m.tier === "B")!)).toBeNull();
    const plusOne = [...two, touch(c.id, "meeting", "2026-05-01")];
    expect(callCover(c.id, plusOne, three.find((m) => m.tier === "B")!)!.endsOn).toBe(
      addDays("2026-02-01", 365),
    );
  });

  it("does nothing when the tier has it off", () => {
    const events = ["2026-02-01", "2026-04-01"].map((d) => touch(c.id, "meeting", d));
    expect(callCover(c.id, events, { ...model("B"), meetingsCoverCalls: null })).toBeNull();
    expect(callCover(c.id, events, { ...model("B"), meetingsCoverCalls: undefined })).toBeNull();
  });
});

describe("the call due date", () => {
  it("waits until the cover ends — the owner's B example", () => {
    // Met in November and May, last call in March. The plain cadence would
    // have the call due June 1st; two meetings in 12 months mean it isn't due
    // until the November meeting turns a year old.
    const c = mkClient({ tier: "B" });
    const older = touch(c.id, "meeting", "2025-11-23");
    const events = [older, touch(c.id, "meeting", "2026-05-22"), touch(c.id, "call", "2026-03-03")];
    const call = callRow(computeClientDueDates(c, events, MODELS))!;
    expect(call.dueDate).toBe("2026-11-23");
    expect(call.computedFromEventId).toBe(older.id);
  });

  it("applies to Tier C too", () => {
    const c = mkClient({ tier: "C" });
    const events = [
      touch(c.id, "meeting", "2026-01-10"),
      touch(c.id, "meeting", "2026-04-10"),
      touch(c.id, "call", "2025-12-01"),
    ];
    expect(callRow(computeClientDueDates(c, events, MODELS))!.dueDate).toBe(addDays("2026-01-10", 365));
  });

  it("lets S and A households on a 90-day meeting cadence go without calls", () => {
    const c = mkClient({ tier: "A" });
    const events = [
      touch(c.id, "meeting", "2026-03-10"),
      touch(c.id, "meeting", "2026-06-08"),
      touch(c.id, "call", "2026-01-15"),
    ];
    // Plain cadence: due Feb 14th, months overdue. Covered: due next March.
    expect(callRow(computeClientDueDates(c, events, MODELS))!.dueDate).toBe(addDays("2026-03-10", 365));
  });

  it("never creates a call for a household that has never had one", () => {
    // The rule only ever pushes a call later. Creating one here would hand the
    // advisor an overdue task for meeting a household MORE.
    const c = mkClient({ tier: "B" });
    const events = [touch(c.id, "meeting", "2024-02-01"), touch(c.id, "meeting", "2024-08-01")];
    expect(callRow(computeClientDueDates(c, events, MODELS))).toBeUndefined();
  });

  it("keeps the plain cadence when the last call already reaches further", () => {
    const c = mkClient({ tier: "B" });
    const lastCall = touch(c.id, "call", "2026-06-10");
    const events = [touch(c.id, "meeting", "2025-06-20"), touch(c.id, "meeting", "2025-09-01"), lastCall];
    // Cover ends 2026-06-20; the call clock reaches 2026-09-08.
    const call = callRow(computeClientDueDates(c, events, MODELS))!;
    expect(call.dueDate).toBe(addDays("2026-06-10", 90));
    expect(call.computedFromEventId).toBe(lastCall.id);
  });

  it("gives a tie to the call, which explains itself", () => {
    const c = mkClient({ tier: "B" });
    const lastCall = touch(c.id, "call", "2026-03-03");
    // Cover ends 2025-06-01 + 365 = 2026-06-01 = 2026-03-03 + 90.
    const events = [touch(c.id, "meeting", "2025-06-01"), touch(c.id, "meeting", "2025-12-01"), lastCall];
    const call = callRow(computeClientDueDates(c, events, MODELS))!;
    expect(call.dueDate).toBe("2026-06-01");
    expect(call.computedFromEventId).toBe(lastCall.id);
  });

  it("is untouched with the rule off", () => {
    const c = mkClient({ tier: "B" });
    const events = [
      touch(c.id, "meeting", "2025-11-23"),
      touch(c.id, "meeting", "2026-05-22"),
      touch(c.id, "call", "2026-03-03"),
    ];
    expect(callRow(computeClientDueDates(c, events, withCover("B", null)))!.dueDate).toBe("2026-06-01");
    expect(callRow(computeClientDueDates(c, events, withCover("B", undefined)))!.dueDate).toBe("2026-06-01");
  });

  it("never moves the meeting clock", () => {
    const c = mkClient({ tier: "B" });
    const last = touch(c.id, "meeting", "2026-05-22");
    const events = [touch(c.id, "meeting", "2025-11-23"), last, touch(c.id, "call", "2026-03-03")];
    const meeting = meetingRow(computeClientDueDates(c, events, MODELS))!;
    expect(meeting.dueDate).toBe(addDays("2026-05-22", 365));
    expect(meeting.computedFromEventId).toBe(last.id);
  });

  it("a late meeting doesn't shorten how long an overdue call has been due", () => {
    // Tier A: met March and June 2025, last call May 2025. The calls were
    // covered until March 2026 and have been due since. Finally meeting them
    // in November 2026 must not rewrite that to "due since June 2026".
    const c = mkClient({ tier: "A" });
    const before = [
      touch(c.id, "meeting", "2025-03-01"),
      touch(c.id, "meeting", "2025-06-01"),
      touch(c.id, "call", "2025-05-15"),
    ];
    expect(callRow(computeClientDueDates(c, before, MODELS))!.dueDate).toBe("2026-03-01");
    const after = [...before, touch(c.id, "meeting", "2026-11-19")];
    expect(callRow(computeClientDueDates(c, after, MODELS))!.dueDate).toBe("2026-03-01");
  });

  it("falls back to the call cadence when a covering meeting is deleted", () => {
    const c = mkClient({ tier: "B" });
    const events = [
      touch(c.id, "meeting", "2025-11-23"),
      touch(c.id, "meeting", "2026-05-22"),
      touch(c.id, "call", "2026-03-03"),
    ];
    const afterDelete = events.filter((e) => e.eventDate !== "2026-05-22");
    expect(callRow(computeClientDueDates(c, afterDelete, MODELS))!.dueDate).toBe("2026-06-01");
  });
});

describe("snoozes survive recomputes that don't change the row's source", () => {
  const c = mkClient({ tier: "B" });
  const base = [
    touch(c.id, "meeting", "2026-01-10"),
    touch(c.id, "call", "2026-05-01"),
  ];

  function parked(rows: DueDate[], type: "meeting" | "call", until: string): DueDate[] {
    return rows.map((r) => (r.type === type ? { ...r, snoozedUntil: until } : r));
  }

  it("logging a call no longer un-books the booked meeting", () => {
    const booked = parked(computeClientDueDates(c, base, MODELS), "meeting", "2026-07-15");
    const after = computeClientDueDates(c, [...base, touch(c.id, "call", "2026-06-10")], MODELS, undefined, booked);
    expect(meetingRow(after)!.snoozedUntil).toBe("2026-07-15");
  });

  it("the booked meeting happening clears its booking", () => {
    const booked = parked(computeClientDueDates(c, base, MODELS), "meeting", "2026-07-15");
    const after = computeClientDueDates(c, [...base, touch(c.id, "meeting", "2026-06-10")], MODELS, undefined, booked);
    expect(meetingRow(after)!.snoozedUntil).toBeNull();
  });

  it("a fresh call clears the call's own voicemail snooze", () => {
    const vm = parked(computeClientDueDates(c, base, MODELS), "call", "2026-06-14");
    const after = computeClientDueDates(c, [...base, touch(c.id, "call", "2026-06-11")], MODELS, undefined, vm);
    expect(callRow(after)!.snoozedUntil).toBeNull();
  });

  it("a tier or rule change with no new contact keeps every snooze", () => {
    const both = parked(parked(computeClientDueDates(c, base, MODELS), "call", "2026-06-14"), "meeting", "2026-07-15");
    const after = computeClientDueDates(c, base, withCover("B", null), undefined, both);
    expect(callRow(after)!.snoozedUntil).toBe("2026-06-14");
    expect(meetingRow(after)!.snoozedUntil).toBe("2026-07-15");
  });

  it("a call row that moves onto a covering meeting keeps its snooze", () => {
    const vm = parked(computeClientDueDates(c, base, MODELS), "call", "2026-06-14");
    const after = computeClientDueDates(c, [...base, touch(c.id, "meeting", "2026-06-05")], MODELS, undefined, vm);
    expect(callRow(after)!.dueDate).toBe(addDays("2026-01-10", 365));
    expect(callRow(after)!.snoozedUntil).toBe("2026-06-14");
  });

  it("with no previous rows, nothing is snoozed — the old behaviour", () => {
    for (const r of computeClientDueDates(c, base, MODELS)) expect(r.snoozedUntil).toBeNull();
  });
});

describe("the score credits the calls when meetings cover them", () => {
  it("B with two meetings and no calls scores 100", () => {
    const c = mkClient({ tier: "B" });
    const events = [touch(c.id, "meeting", "2025-12-01"), touch(c.id, "meeting", "2026-05-01")];
    const s = clientScore(c, events, MODELS, TODAY);
    expect(s.callsCovered).toBe(true);
    expect(s.completedCalls).toBe(0); // raw stays honest
    expect(s.creditedCalls).toBe(s.requiredCalls);
    expect(s.score).toBe(100);
  });

  it("C with two meetings scores 100 too", () => {
    const c = mkClient({ tier: "C" });
    const events = [touch(c.id, "meeting", "2025-12-01"), touch(c.id, "meeting", "2026-05-01")];
    expect(clientScore(c, events, MODELS, TODAY).score).toBe(100);
  });

  it("A with two of its four meetings: calls fulfilled, meetings still short", () => {
    const c = mkClient({ tier: "A" });
    const events = [touch(c.id, "meeting", "2025-12-01"), touch(c.id, "meeting", "2026-03-01")];
    const s = clientScore(c, events, MODELS, TODAY);
    expect(s.callsCovered).toBe(true);
    expect(s.requiredMeetings).toBe(4);
    expect(s.requiredCalls).toBe(12);
    expect(s.score).toBe(Math.round(((2 + 12) / 16) * 100));
  });

  it("one meeting covers nothing", () => {
    const c = mkClient({ tier: "B" });
    const s = clientScore(c, [touch(c.id, "meeting", "2026-05-01")], MODELS, TODAY);
    expect(s.callsCovered).toBe(false);
    expect(s.score).toBe(Math.round((1 / 5) * 100));
  });

  it("one meeting logged twice covers nothing", () => {
    const c = mkClient({ tier: "B" });
    const events = [touch(c.id, "meeting", "2026-05-01"), touch(c.id, "meeting", "2026-05-01")];
    expect(clientScore(c, events, MODELS, TODAY).callsCovered).toBe(false);
  });

  it("off means the old arithmetic", () => {
    const c = mkClient({ tier: "B" });
    const events = [touch(c.id, "meeting", "2025-12-01"), touch(c.id, "meeting", "2026-05-01")];
    const s = clientScore(c, events, withCover("B", null), TODAY);
    expect(s.callsCovered).toBe(false);
    expect(s.score).toBe(Math.round((1 / 5) * 100));
  });

  it("a household two months in still needs two real meetings", () => {
    const c = mkClient({ tier: "B", createdAt: "2026-04-11T00:00:00.000Z" });
    const one = [touch(c.id, "meeting", "2026-04-20")];
    expect(clientScore(c, one, MODELS, TODAY).callsCovered).toBe(false);
    const two = [...one, touch(c.id, "meeting", "2026-06-01")];
    expect(clientScore(c, two, MODELS, TODAY).score).toBe(100);
  });

  it("the queue and the score stop covering on the very same day", () => {
    // Whatever the history, a call comes back onto the queue (its cover ends)
    // on exactly the day the score stops crediting the calls.
    const c = mkClient({ tier: "B" });
    const events = [
      touch(c.id, "meeting", "2025-06-15"),
      touch(c.id, "meeting", "2025-10-02"),
      touch(c.id, "call", "2025-07-01"),
    ];
    const endsOn = callCover(c.id, events, model("B"))!.endsOn;
    expect(clientScore(c, events, MODELS, addDays(endsOn, -1)).callsCovered).toBe(true);
    expect(clientScore(c, events, MODELS, endsOn).callsCovered).toBe(false);
    expect(callRow(computeClientDueDates(c, events, MODELS))!.dueDate).toBe(endsOn);
  });

  it("holds that same-day property across many random histories", () => {
    // A cheap property test: random meeting dates, check every day of a year.
    let rnd = 7;
    const next = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 40; trial++) {
      const c = mkClient({ tier: "B" });
      const events = Array.from({ length: 1 + Math.floor(next() * 4) }, () =>
        touch(c.id, "meeting", addDays("2025-01-01", Math.floor(next() * 520))),
      );
      const cover = callCover(c.id, events, model("B"));
      for (let d = 0; d < 400; d += 7) {
        const day = addDays("2025-06-01", d);
        const inWindow = events.filter((e) => e.eventDate <= day);
        const expected = (() => {
          // Ground truth from first principles: 2 distinct days in (day-365, day].
          const days = new Set(inWindow.filter((e) => e.eventDate > addDays(day, -365)).map((e) => e.eventDate));
          return days.size >= 2;
        })();
        expect(clientScore(c, events, MODELS, day).callsCovered).toBe(expected);
        // And whenever the score is covered as of `day`, the cover (computed
        // from all history) runs past `day`.
        if (expected) expect(cover && cover.endsOn > day).toBe(true);
      }
    }
  });
});

describe("rollups and the pace target follow the rule", () => {
  it("sums each household's credited touches", () => {
    const covered = mkClient({ tier: "B" });
    const plain = mkClient({ tier: "C" });
    const events = [
      touch(covered.id, "meeting", "2025-12-01"),
      touch(covered.id, "meeting", "2026-05-01"),
      touch(plain.id, "meeting", "2026-03-01"),
      touch(plain.id, "call", "2026-04-01"),
    ];
    const r = rollupScore([covered, plain], events, MODELS, TODAY)!;
    // B: 1 meeting + 4 credited calls of 5. C: 1 meeting + 1 call of 3.
    expect(r.completedMeetings + r.completedCalls).toBe(5 + 2);
    expect(r.requiredMeetings + r.requiredCalls).toBe(5 + 3);
    expect(r.score).toBe(Math.round((7 / 8) * 100));
  });

  it("a covered household owes only its meetings toward the monthly target", () => {
    expect(coveredAnnualTouches(model("A"))).toBe(4);
    expect(coveredAnnualTouches(model("B"))).toBe(2); // never fewer than the cover takes
    expect(coveredAnnualTouches({ ...model("B"), meetingsCoverCalls: null })).toBeNull();

    const c = mkClient({ tier: "A" });
    const events = [touch(c.id, "meeting", "2026-01-10"), touch(c.id, "meeting", "2026-04-10")];
    expect(monthlyProgress([c], MODELS, events, TODAY).target).toBe(Math.round(4 / 12));
    expect(monthlyProgress([c], withCover("A", null), events, TODAY).target).toBe(Math.round(16 / 12));
  });
});
