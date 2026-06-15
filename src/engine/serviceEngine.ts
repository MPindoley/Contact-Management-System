// The service engine: due-date math, task generation, and service scores.
// Pure functions over plain data — the demo adapter runs these in the browser,
// and supabase/migrations/0001_init.sql implements the same rules as database
// triggers. Keep the two in sync.

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
import { addDays, diffDays, monthKey } from "../lib/dates";

/** Tasks surface this many days before they are due (matches fn_task_horizon). */
export const TASK_HORIZON_DAYS = 14;

const TOUCH_TYPES: TouchType[] = ["meeting", "call"];

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

/**
 * Recompute a client's due dates from their contact history: one row per
 * touch type, derived from the latest qualifying event (admin touches never
 * reset the clock). A meeting resets the meeting clock and a call resets the
 * call clock — the two cadences are tracked independently, which is what
 * makes Tier A ≈ 4 meetings + 12 calls a year.
 */
export function computeClientDueDates(
  client: Client,
  allEvents: ContactEvent[],
  models: ServiceModel[],
  nowISO: string = new Date().toISOString(),
): DueDate[] {
  const model = modelFor(models, client.tier);
  const result: DueDate[] = [];

  for (const type of TOUCH_TYPES) {
    const latest = allEvents
      .filter((e) => e.clientId === client.id && e.type === type)
      .reduce<ContactEvent | null>((best, e) => {
        if (!best) return e;
        if (e.eventDate > best.eventDate) return e;
        if (e.eventDate === best.eventDate && e.createdAt > best.createdAt) return e;
        return best;
      }, null);

    if (latest) {
      result.push({
        id: `due_${client.id}_${type}`,
        clientId: client.id,
        type,
        dueDate: nextDueDate(latest.eventDate, type, model),
        computedFromEventId: latest.id,
        // A fresh contact resets the clock, so any prior snooze is cleared.
        snoozedUntil: null,
        updatedAt: nowISO,
      });
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
  completedMeetings: number;
  requiredMeetings: number;
  completedCalls: number;
  requiredCalls: number;
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
  const windowStart = addDays(today, -365);
  const events = allEvents.filter((e) => e.clientId === client.id && e.type !== "admin");

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

  const credit =
    Math.min(completedMeetings, required.meetings) + Math.min(completedCalls, required.calls);
  const score = Math.round((credit / (required.meetings + required.calls)) * 100);

  return {
    completedMeetings,
    requiredMeetings: required.meetings,
    completedCalls,
    requiredCalls: required.calls,
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
    score: 0,
  };

  for (const client of active) {
    const s = clientScore(client, allEvents, models, today);
    sum.completedMeetings += Math.min(s.completedMeetings, s.requiredMeetings);
    sum.completedCalls += Math.min(s.completedCalls, s.requiredCalls);
    sum.requiredMeetings += s.requiredMeetings;
    sum.requiredCalls += s.requiredCalls;
  }

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
    (e) => e.type !== "admin" && monthKey(e.eventDate) === month && e.eventDate <= today,
  ).length;

  const annualTotal = clients
    .filter((c) => c.active)
    .reduce((sum, c) => sum + annualRequired(modelFor(models, c.tier)).total, 0);

  return { completed, target: Math.round(annualTotal / 12) };
}
