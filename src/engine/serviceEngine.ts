// The service engine: due-date math, task generation, and service scores.
// Pure functions over plain data — the demo adapter runs these in the browser,
// and the database implements the same due-date rules as triggers:
// supabase/migrations/0001_init.sql for a fresh install, and the latest
// migration to replace fn_recompute_client_due_dates (0013) for a live one.
// Keep them in sync — supabase/tests/parity_test.sh checks they agree.

import type {
  Client,
  ContactEvent,
  DueDate,
  Priority,
  ServiceModel,
  Task,
  Tier,
  TouchType,
} from "../types";
import { isMeaningfulContact } from "../types";
import { addDays, diffDays, monthKey } from "../lib/dates";

/** Tasks surface this many days before they are due (matches fn_task_horizon). */
export const TASK_HORIZON_DAYS = 14;

export function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function modelFor(models: ServiceModel[], tier: Tier): ServiceModel {
  const model = models.find((m) => m.tier === tier);
  if (!model) throw new Error(`No service model defined for tier ${tier}`);
  return model;
}

export function intervalFor(model: ServiceModel, type: TouchType): number {
  return type === "meeting" ? model.meetingIntervalDays : model.callIntervalDays;
}

/** Last contact date + the tier's interval. The core mechanic of the system. */
export function nextDueDate(eventDate: string, type: TouchType, model: ServiceModel): string {
  return addDays(eventDate, intervalFor(model, type));
}

/** The trailing window the score uses, and the one meetings cover calls over. */
export const SCORE_WINDOW_DAYS = 365;

/** What a tier gets when meetings-cover-calls is switched on. The owner's "twice". */
export const DEFAULT_MEETINGS_COVER_CALLS = 2;
const MIN_MEETINGS_COVER = 2;
const MAX_MEETINGS_COVER = 12;

/**
 * How many meetings in 12 months cover a tier's calls, or null if the tier
 * doesn't use the rule. undefined (the database predates the setting), null,
 * and anything outside 2–12 all read as off, so nothing downstream ever has to
 * reason about a half-configured value.
 */
export function coverThreshold(model: ServiceModel): number | null {
  const n = model.meetingsCoverCalls;
  return typeof n === "number" &&
    Number.isInteger(n) &&
    n >= MIN_MEETINGS_COVER &&
    n <= MAX_MEETINGS_COVER
    ? n
    : null;
}

/**
 * The one ordering both engines use for "the latest event": by date, then by
 * when it was logged, then by id. The SQL twin is
 * `order by event_date desc, created_at desc, id desc`.
 */
function isLater(a: ContactEvent, b: ContactEvent): boolean {
  if (a.eventDate !== b.eventDate) return a.eventDate > b.eventDate;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.id > b.id;
}

function latestOfType(clientId: string, events: ContactEvent[], type: TouchType): ContactEvent | null {
  let best: ContactEvent | null = null;
  for (const e of events) {
    if (e.clientId !== clientId || e.type !== type) continue;
    if (!best || isLater(e, best)) best = e;
  }
  return best;
}

/**
 * Can this meeting count toward covering the calls? Only if it wasn't dated
 * after the day it was logged. The app never lets you pick a future date, but a
 * CSV import will happily take a typo like "11/10/27", and one future meeting
 * would otherwise switch a household's calls off for a year without anyone
 * noticing. Decided from the event alone, so it never depends on today and the
 * stored due date stays stable. SQL twin:
 * `event_date <= (created_at at time zone 'utc')::date`.
 */
function countsTowardCover(e: ContactEvent): boolean {
  return e.type === "meeting" && (!e.createdAt || e.eventDate <= utcDay(e.createdAt));
}

/** The UTC calendar day of a timestamp, whatever offset it was written with. */
function utcDay(timestamp: string): string {
  const t = Date.parse(timestamp);
  return Number.isNaN(t) ? timestamp.slice(0, 10) : new Date(t).toISOString().slice(0, 10);
}

export interface CallCover {
  /** The day the covering meetings stop covering: the oldest of them + 365. */
  endsOn: string;
  /** The oldest covering meeting: the one whose ageing-out ends the cover. */
  sourceEventId: string;
  /** The N covering meeting dates, newest first. */
  meetingDates: string[];
}

/**
 * When a tier lets meetings cover its calls: N meetings (on distinct days)
 * within 12 months of each other take care of the calls until the oldest of
 * them turns a year old.
 *
 * The latest such run of N meetings wins. Usually that is simply the N most
 * recent, but not when they are more than a year apart: meetings in March
 * 2025 and November 2026 were never "two in a year", so they cover nothing,
 * and an earlier pair that did fit still dates when the cover ran out. (Taking
 * the N most recent regardless would let a late meeting quietly shorten how
 * long an overdue call had been overdue.)
 *
 * Distinct days, not rows: a meeting logged twice by mistake, or by Matt and
 * Beau for the same sit-down, is still one meeting.
 *
 * Deliberately a pure function of the household's history — it never reads
 * today — because the due date it feeds is stored and only recomputed when
 * history changes. The nightly job only re-ages tasks against stored dates.
 */
export function callCover(
  clientId: string,
  allEvents: ContactEvent[],
  model: ServiceModel,
): CallCover | null {
  const n = coverThreshold(model);
  if (n === null) return null;

  // One representative event per day, chosen by the shared ordering.
  const byDate = new Map<string, ContactEvent>();
  for (const e of allEvents) {
    if (e.clientId !== clientId || !countsTowardCover(e)) continue;
    const current = byDate.get(e.eventDate);
    if (!current || isLater(e, current)) byDate.set(e.eventDate, e);
  }
  const dates = [...byDate.keys()].sort().reverse();

  // dates[i] is the newest of a run of n days, dates[i + n - 1] the oldest.
  // The run fits in a year when the oldest's year isn't over by the day of the
  // newest.
  for (let i = 0; i + n - 1 < dates.length; i++) {
    const oldest = byDate.get(dates[i + n - 1])!;
    const endsOn = addDays(oldest.eventDate, SCORE_WINDOW_DAYS);
    if (endsOn > dates[i]) {
      return { endsOn, sourceEventId: oldest.id, meetingDates: dates.slice(i, i + n) };
    }
  }
  return null;
}

/**
 * Recompute a client's due dates from their contact history: one row per
 * touch type, derived from the latest qualifying event (admin touches never
 * reset the clock). A meeting resets the meeting clock and a call resets the
 * call clock — the two cadences are tracked independently, which is what
 * makes Tier A ≈ 4 meetings + 12 calls a year.
 *
 * Where the tier lets meetings cover calls (callCover), the call is due no
 * sooner than the day that cover ends. The rule only ever pushes a call LATER:
 * it never creates a call row for a household that has never had a call, so it
 * can't drop a surprise overdue task on anyone.
 *
 * `previous` is the client's current rows. A snooze — a voicemail's "try again
 * in 3 days", or a booked meeting parked until its day — is kept unless the row
 * now comes from a different contact. So logging a CALL no longer un-books the
 * booked MEETING, and a tier edit no longer un-parks the whole book. A call row
 * that moves onto a covering meeting keeps its snooze too: that only happens
 * when the call has been pushed later, so the snooze is harmless either way.
 */
export function computeClientDueDates(
  client: Client,
  allEvents: ContactEvent[],
  models: ServiceModel[],
  nowISO: string = new Date().toISOString(),
  previous: DueDate[] = [],
): DueDate[] {
  const model = modelFor(models, client.tier);
  const result: DueDate[] = [];

  const row = (type: TouchType, dueDate: string, sourceId: string, coverSourced: boolean): DueDate => {
    const prev = previous.find((d) => d.clientId === client.id && d.type === type);
    const keep = !!prev && (prev.computedFromEventId === sourceId || coverSourced);
    return {
      id: `due_${client.id}_${type}`,
      clientId: client.id,
      type,
      dueDate,
      computedFromEventId: sourceId,
      snoozedUntil: keep ? prev!.snoozedUntil : null,
      updatedAt: nowISO,
    };
  };

  const lastMeeting = latestOfType(client.id, allEvents, "meeting");
  if (lastMeeting) {
    result.push(row("meeting", nextDueDate(lastMeeting.eventDate, "meeting", model), lastMeeting.id, false));
  }

  const lastCall = latestOfType(client.id, allEvents, "call");
  if (lastCall) {
    const callTerm = nextDueDate(lastCall.eventDate, "call", model);
    const cover = callCover(client.id, allEvents, model);
    // A tie goes to the call: the plain cadence explains itself.
    if (cover && cover.endsOn > callTerm) {
      result.push(row("call", cover.endsOn, cover.sourceEventId, true));
    } else {
      result.push(row("call", callTerm, lastCall.id, false));
    }
  }

  return result;
}

/** Overdue items auto-escalate to high; due-today is medium; upcoming is low. */
export function taskPriority(dueDate: string, today: string): Priority {
  if (dueDate < today) return "high";
  if (dueDate === today) return "medium";
  return "low";
}

/** Open tasks for one client, generated from its due dates as of `today`. */
export function buildClientTasks(client: Client, dueDates: DueDate[], today: string): Task[] {
  if (!client.active) return [];
  return dueDates
    .filter(
      (d) =>
        d.clientId === client.id &&
        d.dueDate <= addDays(today, TASK_HORIZON_DAYS) &&
        // Snoozed touches drop off the queue until the snooze date passes.
        (d.snoozedUntil === null || d.snoozedUntil <= today),
    )
    .map((d) => ({
      id: uid(),
      clientId: client.id,
      type: d.type,
      dueDate: d.dueDate,
      daysOverdue: Math.max(0, diffDays(d.dueDate, today)),
      priority: taskPriority(d.dueDate, today),
      status: "open" as const,
      createdAt: new Date().toISOString(),
    }));
}

/**
 * The nightly 6am job: throw away open tasks, regenerate them from due dates,
 * re-age days_overdue, escalate priorities. Done tasks are kept as history.
 */
export function rebuildAllTasks(
  clients: Client[],
  dueDates: DueDate[],
  existingTasks: Task[],
  today: string,
): Task[] {
  const done = existingTasks.filter((t) => t.status === "done");
  const open = clients.flatMap((c) => buildClientTasks(c, dueDates, today));
  return [...done, ...open];
}

/** A completed touch settles the matching open task. */
export function settleTasks(tasks: Task[], clientId: string, type: TouchType): Task[] {
  return tasks.map((t) =>
    t.clientId === clientId && t.type === type && t.status === "open"
      ? { ...t, status: "done" as const }
      : t,
  );
}

// ---------------------------------------------------------------------------
// Dashboard buckets
// ---------------------------------------------------------------------------

export interface QueueBuckets {
  callsToday: Task[];
  meetingsToday: Task[];
  overdue: Task[];
  upcoming: Task[];
}

export function dashboardBuckets(tasks: Task[], today: string): QueueBuckets {
  const open = tasks.filter((t) => t.status === "open");
  const byDueAsc = (a: Task, b: Task) => a.dueDate.localeCompare(b.dueDate);
  return {
    callsToday: open.filter((t) => t.type === "call" && t.dueDate === today),
    meetingsToday: open.filter((t) => t.type === "meeting" && t.dueDate === today),
    overdue: open
      .filter((t) => t.dueDate < today)
      .sort((a, b) => b.daysOverdue - a.daysOverdue),
    upcoming: open.filter((t) => t.dueDate > today).sort(byDueAsc),
  };
}

// ---------------------------------------------------------------------------
// Service score
// score = contacts completed on schedule ÷ contacts required, trailing 12 mo.
// Tier A requires ~16/yr, B ~5, C ~3 (derived from the editable intervals).
// ---------------------------------------------------------------------------

export interface ScoreBreakdown {
  /** Meetings actually logged in the window. Raw, so the profile stays honest. */
  completedMeetings: number;
  requiredMeetings: number;
  /** Calls actually logged in the window. Raw — a covered household may show 0. */
  completedCalls: number;
  requiredCalls: number;
  /** What the score counted: completed, capped at required. */
  creditedMeetings: number;
  /** Capped calls — or every required call, when meetings cover them. */
  creditedCalls: number;
  /** The tier lets meetings cover calls, and enough happened in the window. */
  callsCovered: boolean;
  /** 0–100 */
  score: number;
}

export function annualRequired(model: ServiceModel): { meetings: number; calls: number; total: number } {
  const meetings = Math.max(1, Math.round(365 / model.meetingIntervalDays));
  const calls = Math.max(1, Math.round(365 / model.callIntervalDays));
  return { meetings, calls, total: meetings + calls };
}

function requiredForTenure(model: ServiceModel, tenureDays: number): { meetings: number; calls: number } {
  const annual = annualRequired(model);
  const factor = Math.min(1, Math.max(tenureDays, 28) / 365);
  return {
    meetings: Math.max(1, Math.round(annual.meetings * factor)),
    calls: Math.max(1, Math.round(annual.calls * factor)),
  };
}

/**
 * One client's health. Requirements prorate for short tenure so a household
 * added last month isn't painted red for missing a year of touches.
 */
export function clientScore(
  client: Client,
  allEvents: ContactEvent[],
  models: ServiceModel[],
  today: string,
): ScoreBreakdown {
  const model = modelFor(models, client.tier);
  const windowStart = addDays(today, -SCORE_WINDOW_DAYS);
  const events = allEvents.filter((e) => e.clientId === client.id && isMeaningfulContact(e.type));

  const earliest = events.reduce<string | null>(
    (min, e) => (min === null || e.eventDate < min ? e.eventDate : min),
    null,
  );
  const createdDate = client.createdAt.slice(0, 10);
  const anchor = earliest && earliest < createdDate ? earliest : createdDate;
  const tenureDays = Math.max(0, diffDays(anchor, today));
  const required = requiredForTenure(model, tenureDays);

  const inWindow = events.filter((e) => e.eventDate > windowStart && e.eventDate <= today);
  const completedMeetings = inWindow.filter((e) => e.type === "meeting").length;
  const completedCalls = inWindow.filter((e) => e.type === "call").length;

  // "If I meet with them twice in the year, that fulfils the call requirement."
  // Counted exactly as callCover counts — distinct days, no future-dated
  // typos — so the score stops crediting the calls on the same day the call
  // comes back onto the queue.
  const threshold = coverThreshold(model);
  const coveringDays = new Set(inWindow.filter(countsTowardCover).map((e) => e.eventDate)).size;
  const callsCovered = threshold !== null && coveringDays >= threshold;

  const creditedMeetings = Math.min(completedMeetings, required.meetings);
  const creditedCalls = callsCovered ? required.calls : Math.min(completedCalls, required.calls);
  const score = Math.round(
    ((creditedMeetings + creditedCalls) / (required.meetings + required.calls)) * 100,
  );

  return {
    completedMeetings,
    requiredMeetings: required.meetings,
    completedCalls,
    requiredCalls: required.calls,
    creditedMeetings,
    creditedCalls,
    callsCovered,
    score,
  };
}

/**
 * Roll a set of clients up into one score (per advisor, per tier, or firm).
 * Weighted by required contacts, so a neglected Tier A household moves the
 * needle more than a quiet Tier C one. Returns null for an empty set.
 */
export function rollupScore(
  clients: Client[],
  allEvents: ContactEvent[],
  models: ServiceModel[],
  today: string,
): ScoreBreakdown | null {
  const active = clients.filter((c) => c.active);
  if (active.length === 0) return null;

  const sum: ScoreBreakdown = {
    completedMeetings: 0,
    requiredMeetings: 0,
    completedCalls: 0,
    requiredCalls: 0,
    creditedMeetings: 0,
    creditedCalls: 0,
    callsCovered: false,
    score: 0,
  };

  // Sum what each household was CREDITED, not its raw counts: otherwise a
  // covered household's calls would count in its own score but vanish from
  // the advisor, tier and firm rollups. The completed* fields here are the
  // credited sums, which is what the report's "touches credited" shows.
  for (const client of active) {
    const s = clientScore(client, allEvents, models, today);
    sum.completedMeetings += s.creditedMeetings;
    sum.completedCalls += s.creditedCalls;
    sum.requiredMeetings += s.requiredMeetings;
    sum.requiredCalls += s.requiredCalls;
  }
  sum.creditedMeetings = sum.completedMeetings;
  sum.creditedCalls = sum.completedCalls;

  const required = sum.requiredMeetings + sum.requiredCalls;
  sum.score = required === 0 ? 100 : Math.round(((sum.completedMeetings + sum.completedCalls) / required) * 100);
  return sum;
}

export type ScoreColor = "green" | "yellow" | "red";

export function scoreColor(score: number): ScoreColor {
  if (score >= 90) return "green";
  if (score >= 70) return "yellow";
  return "red";
}

/** Contacts completed this month vs the pace the service models demand. */
export function monthlyProgress(
  clients: Client[],
  models: ServiceModel[],
  allEvents: ContactEvent[],
  today: string,
): { completed: number; target: number } {
  const month = monthKey(today);
  const completed = allEvents.filter(
    (e) => isMeaningfulContact(e.type) && monthKey(e.eventDate) === month && e.eventDate <= today,
  ).length;

  // A household whose meetings cover its calls owes only its meetings — no
  // fewer than the cover takes — so the target doesn't keep asking for calls
  // that are already counted as done.
  const annualTotal = clients
    .filter((c) => c.active)
    .reduce((sum, c) => {
      const model = modelFor(models, c.tier);
      const covered = clientScore(c, allEvents, models, today).callsCovered;
      return sum + (covered ? coveredAnnualTouches(model)! : annualRequired(model).total);
    }, 0);

  return { completed, target: Math.round(annualTotal / 12) };
}

/**
 * What a household owes in a year when its meetings cover its calls: its
 * meetings, and never fewer than the cover takes. null when the tier is off.
 */
export function coveredAnnualTouches(model: ServiceModel): number | null {
  const n = coverThreshold(model);
  return n === null ? null : Math.max(annualRequired(model).meetings, n);
}
