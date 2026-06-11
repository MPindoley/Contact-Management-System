// Date helpers. The whole domain runs on local-calendar `YYYY-MM-DD` strings —
// service cadences care about days, never times or timezones.

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Whole days from `a` to `b` (positive when `b` is after `a`). */
export function diffDays(a: string, b: string): number {
  const ms = parseISO(b).getTime() - parseISO(a).getTime();
  return Math.round(ms / 86_400_000);
}

const LONG = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const MEDIUM = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

/** "Wednesday, June 11" */
export function formatLong(iso: string): string {
  return LONG.format(parseISO(iso));
}

/** "Jun 11, 2026" */
export function formatMedium(iso: string): string {
  return MEDIUM.format(parseISO(iso));
}

/** "Jun 11" — year added only when it differs from the current year. */
export function formatShort(iso: string): string {
  const d = parseISO(iso);
  return d.getFullYear() === new Date().getFullYear() ? SHORT.format(d) : MEDIUM.format(d);
}

/** "June 2026" */
export function formatMonth(iso: string): string {
  return MONTH.format(parseISO(iso));
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Human phrasing relative to today: "due today", "3 days overdue", "due in 12 days". */
export function dueLabel(dueISO: string, today: string): string {
  const delta = diffDays(today, dueISO);
  if (delta === 0) return "due today";
  if (delta < 0) return `${-delta} ${-delta === 1 ? "day" : "days"} overdue`;
  if (delta === 1) return "due tomorrow";
  return `due in ${delta} days`;
}

export function timeOfDayGreeting(d: Date = new Date()): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
