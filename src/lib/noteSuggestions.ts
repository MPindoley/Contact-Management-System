// Read a dictated (or typed) note and pull out the two things worth acting on:
// which opportunity tags it mentions, and when to see the household next.
//
// Deliberately keyword-driven rather than an AI call: it is instant, free, runs
// with no vendor involved (nothing leaves the browser), and — most importantly
// for a book of business — it is predictable. The same words always produce the
// same suggestion, and the advisor confirms before anything is saved.

import { CLIENT_TAG_LABELS, type ClientTag } from "../types";
import { addDays } from "./dates";

/** Phrases that imply a tag. Lower-case; matched on word boundaries. */
const TAG_PHRASES: Record<ClientTag, string[]> = {
  roth_conversion: ["roth", "roth conversion", "convert to roth", "backdoor roth"],
  side_fund: ["side fund", "side account", "side money", "sidefund"],
  ltc_insurance: ["long term care", "long-term care", "ltc", "nursing home", "home health care"],
  money_due: [
    "money due", "money owed", "held away", "held-away", "outside money",
    "money to capture", "old 401k", "old 401(k)", "orphan account",
  ],
  life_insurance: ["life insurance", "term life", "whole life", "death benefit", "iul"],
  college_529: ["529", "college fund", "college savings", "tuition", "education savings"],
  estate_beneficiary: [
    "estate plan", "estate planning", "beneficiary", "beneficiaries",
    "living trust", "revocable trust", "power of attorney", "will update", "update the will",
  ],
  tax_planning: [
    "tax planning", "tax strategy", "capital gains", "tax loss", "tax-loss",
    "harvest", "cpa", "taxable income", "bracket",
  ],
  annuity_review: ["annuity", "annuities"],
  rmd: ["rmd", "required minimum", "required minimum distribution"],
};

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

export interface NoteSuggestions {
  /** Tags the note mentions that the household doesn't already carry. */
  tags: ClientTag[];
  /** A follow-up date the note implies, if any. */
  meetingDate: string | null;
  /** The words that produced the date — shown so the advisor can sanity-check it. */
  meetingPhrase: string | null;
}

/** Escape a phrase for use in a regex. */
function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A phrase matches only on word boundaries, so "rmd" doesn't fire inside
 * "rmdsomething" and "529" doesn't fire inside "15290".
 */
function mentions(haystack: string, phrase: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escape(phrase)}([^a-z0-9]|$)`, "i").test(haystack);
}

export function suggestTags(note: string, existing: ClientTag[] = []): ClientTag[] {
  const text = note.toLowerCase();
  if (!text.trim()) return [];
  const have = new Set(existing);
  const out: ClientTag[] = [];
  for (const tag of Object.keys(TAG_PHRASES) as ClientTag[]) {
    if (have.has(tag)) continue;
    if (TAG_PHRASES[tag].some((p) => mentions(text, p))) out.push(tag);
  }
  // Stable, human order: the order the tags are declared in.
  return out.sort(
    (a, b) =>
      Object.keys(CLIENT_TAG_LABELS).indexOf(a) - Object.keys(CLIENT_TAG_LABELS).indexOf(b),
  );
}

/** ISO date for the given year/month(0-11)/day, clamped to the month's length. */
function iso(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(year, month, Math.min(day, last)));
  return d.toISOString().slice(0, 10);
}

/** The next occurrence of a month, always in the future. */
function nextMonth(today: string, month: number, day: number): string {
  const now = new Date(`${today}T00:00:00Z`);
  const year = now.getUTCFullYear();
  const candidate = iso(year, month, day);
  return candidate > today ? candidate : iso(year + 1, month, day);
}

/**
 * Pull a follow-up date out of the note. Returns the date plus the phrase that
 * produced it, so the UI can show its reasoning instead of a bare date.
 */
export function suggestMeetingDate(
  note: string,
  today: string,
): { date: string; phrase: string } | null {
  const text = note.toLowerCase();
  if (!text.trim()) return null;

  // "in 3 weeks", "in two months", "in 90 days"
  const rel = text.match(
    /\bin\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week|month|year)s?\b/,
  );
  if (rel) {
    const n = WORD_NUMBERS[rel[1]] ?? Number(rel[1]);
    if (Number.isFinite(n) && n > 0) {
      const per = { day: 1, week: 7, month: 30, year: 365 }[rel[2] as "day" | "week" | "month" | "year"];
      return { date: addDays(today, n * per), phrase: rel[0] };
    }
  }

  // "next week" / "next month" / "next quarter" / "next year"
  const next = text.match(/\bnext\s+(week|month|quarter|year)\b/);
  if (next) {
    const days = { week: 7, month: 30, quarter: 91, year: 365 }[next[1] as "week" | "month" | "quarter" | "year"];
    return { date: addDays(today, days), phrase: next[0] };
  }

  // "six months out", "3 weeks from now"
  const bare = text.match(
    /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week|month|year)s?\s+(out|from now|from today)\b/,
  );
  if (bare) {
    const n = WORD_NUMBERS[bare[1]] ?? Number(bare[1]);
    const per = { day: 1, week: 7, month: 30, year: 365 }[bare[2] as "day" | "week" | "month" | "year"];
    if (Number.isFinite(n) && n > 0) return { date: addDays(today, n * per), phrase: bare[0] };
  }

  // A named month, optionally "early/mid/late".
  const month = text.match(
    new RegExp(`\\b(early|mid|middle of|late)?\\s*(${MONTHS.join("|")})\\b`),
  );
  if (month) {
    const idx = MONTHS.indexOf(month[2]);
    const when = (month[1] ?? "").trim();
    const day = when.startsWith("early") ? 5 : when.startsWith("late") ? 25 : 15;
    return { date: nextMonth(today, idx, day), phrase: month[0].trim() };
  }

  // Seasons — a financial-planning year talks in these.
  const season = text.match(/\b(the\s+)?(spring|summer|fall|autumn|winter)\b/);
  if (season) {
    const m = { spring: 3, summer: 6, fall: 9, autumn: 9, winter: 11 }[
      season[2] as "spring" | "summer" | "fall" | "autumn" | "winter"
    ];
    return { date: nextMonth(today, m, 15), phrase: season[0].trim() };
  }

  // "before year-end", "end of the year"
  if (/\b(year[-\s]?end|end of the year)\b/.test(text)) {
    const year = new Date(`${today}T00:00:00Z`).getUTCFullYear();
    const target = iso(year, 11, 15);
    return { date: target > today ? target : iso(year + 1, 11, 15), phrase: "year-end" };
  }

  return null;
}

export function suggestFromNote(
  note: string,
  existing: ClientTag[],
  today: string,
): NoteSuggestions {
  const when = suggestMeetingDate(note, today);
  return {
    tags: suggestTags(note, existing),
    meetingDate: when?.date ?? null,
    meetingPhrase: when?.phrase ?? null,
  };
}
