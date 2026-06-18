// Demo dataset: 15 households with ~14 months of realistic contact history,
// generated relative to "today" so the morning dashboard always has work on
// it — a couple of touches due today, a spread of overdue items, and a few
// things on the horizon. Deterministic (seeded PRNG), so resets are stable.

import type { AdvisorAssignment, AdvisorKey, Client, ContactEvent, ContactType, DataSnapshot, Family, Prospect, ProspectEvent, ServiceModel, Tier, User } from "../../types";
import { addDays } from "../dates";
import { computeClientDueDates, rebuildAllTasks } from "../../engine/serviceEngine";

export const DEMO_USERS: User[] = [
  // Matt is the senior advisor — sees every book. Beau sees only his own.
  { id: "user_matt", name: "Matt", email: "matt@demo.firm", role: "advisor", advisorKey: "matt", seesAllBooks: true },
  { id: "user_advisor_b", name: "Beau", email: "beau@demo.firm", role: "advisor", advisorKey: "advisor_b", seesAllBooks: false },
  { id: "user_assistant", name: "Carolyn", email: "carolyn@demo.firm", role: "assistant", advisorKey: null, seesAllBooks: true },
];

export const DEFAULT_SERVICE_MODELS: ServiceModel[] = [
  { tier: "S", meetingIntervalDays: 90, callIntervalDays: 30, minRevenue: 250000, description: "Your very top households — the relationships you protect above all." },
  { tier: "A", meetingIntervalDays: 90, callIntervalDays: 30, minRevenue: 100000, description: "Core high-value households." },
  { tier: "B", meetingIntervalDays: 365, callIntervalDays: 90, minRevenue: 25000, description: "The steady middle of the book." },
  { tier: "C", meetingIntervalDays: 365, callIntervalDays: 180, minRevenue: null, description: "Lighter-touch relationships, kept warm." },
];

interface SeedSpec {
  name: string;
  tier: Tier;
  advisor: AdvisorAssignment;
  /** Days before today of the most recent meeting / call. */
  lastMeeting: number;
  lastCall: number;
  /** 1.0 = textbook cadence; higher = sloppier history (lower score). */
  discipline: number;
}

// Tuned so today's board shows: 2 calls due today, 2 meetings due today,
// 6 overdue items across all severities, and a lively 14-day horizon.
const SPECS: SeedSpec[] = [
  // Tier A — meeting every 90, call every 30
  { name: "Whitfield, Daniel & Mara",   tier: "S", advisor: "matt",      lastMeeting: -90,  lastCall: -12,  discipline: 1.0 },
  { name: "Castellanos Family",         tier: "S", advisor: "matt",      lastMeeting: -45,  lastCall: -30,  discipline: 1.05 },
  { name: "Okafor, Samuel & Adaeze",    tier: "A", advisor: "advisor_b", lastMeeting: -60,  lastCall: -42,  discipline: 1.4 },
  { name: "Hale-Brennan Household",     tier: "A", advisor: "joint",     lastMeeting: -113, lastCall: -25,  discipline: 1.25 },
  { name: "Vogel, Peter & Anneliese",   tier: "A", advisor: "matt",      lastMeeting: -30,  lastCall: -8,   discipline: 1.0 },
  { name: "Ramaswamy Family Trust",     tier: "A", advisor: "advisor_b", lastMeeting: -85,  lastCall: -28,  discipline: 1.1 },
  // Tier B — meeting every 365, call every 90
  { name: "Beauchamp, Claire",          tier: "B", advisor: "matt",      lastMeeting: -200, lastCall: -90,  discipline: 1.0 },
  { name: "Donnelly Household",         tier: "B", advisor: "advisor_b", lastMeeting: -365, lastCall: -40,  discipline: 1.1 },
  { name: "Fitzgerald, Owen & June",    tier: "B", advisor: "matt",      lastMeeting: -180, lastCall: -95,  discipline: 1.3 },
  { name: "Park, Henry & Soo-Jin",      tier: "B", advisor: "joint",     lastMeeting: -367, lastCall: -30,  discipline: 1.15 },
  { name: "Underwood Family",           tier: "B", advisor: "advisor_b", lastMeeting: -100, lastCall: -20,  discipline: 1.0 },
  { name: "Mercer-Liang Household",     tier: "B", advisor: "matt",      lastMeeting: -300, lastCall: -84,  discipline: 1.05 },
  // Tier C — meeting every 365, call every 180
  { name: "Abernathy, Gordon",          tier: "C", advisor: "matt",      lastMeeting: -405, lastCall: -100, discipline: 1.6 },
  { name: "Salazar Family",             tier: "C", advisor: "advisor_b", lastMeeting: -200, lastCall: -60,  discipline: 1.0 },
  { name: "Tran, Vivian",               tier: "C", advisor: "joint",     lastMeeting: -250, lastCall: -186, discipline: 1.2 },
];

const MEETING_NOTES = [
  "Annual review — portfolio on plan, revisit 529 in the fall.",
  "Q2 rebalance walkthrough; comfortable with allocation.",
  "Retirement income projection updated, no changes needed.",
  "Estate beneficiaries reviewed and confirmed.",
  "Discussed Roth conversion window before year-end.",
  "College funding check-in; bumped monthly contribution.",
];

const CALL_NOTES = [
  "Market volatility check-in — reassured, no action.",
  "Birthday call.",
  "RMD reminder and timing question.",
  "Quick question on wire instructions, resolved.",
  "Touched base after earnings season.",
  "Tax doc walkthrough with their CPA on the line.",
  "Checked in after surgery — recovering well.",
];

const ADMIN_NOTES = [
  "Paperwork follow-up: signed forms received.",
  "Address change processed.",
  "Scheduled next review with assistant.",
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)];
}

/** Walk backwards from the most recent touch at (interval × discipline) ± jitter. */
function offsetsFor(last: number, interval: number, discipline: number, rand: () => number): number[] {
  const offsets: number[] = [];
  let cursor = last;
  while (cursor >= -430) {
    offsets.push(cursor);
    const gap = Math.max(7, Math.round(interval * discipline + (rand() * 10 - 5)));
    cursor -= gap;
  }
  return offsets;
}

export function buildDemoSnapshot(today: string): DataSnapshot {
  const rand = mulberry32(20260611);
  const clients: Client[] = [];
  const events: ContactEvent[] = [];

  SPECS.forEach((spec, i) => {
    const clientId = `client_${String(i + 1).padStart(2, "0")}`;
    const model = DEFAULT_SERVICE_MODELS.find((m) => m.tier === spec.tier)!;

    // The household joined the book before its oldest logged touch.
    const oldest = Math.min(spec.lastMeeting, spec.lastCall) - 60;
    const exchange = 200 + Math.floor(rand() * 700);
    const line = String(1000 + Math.floor(rand() * 9000));
    const tierBaseRevenue: Record<Tier, number> = { S: 300000, A: 140000, B: 45000, C: 9000 };
    clients.push({
      id: clientId,
      householdName: spec.name,
      assignedAdvisor: spec.advisor,
      tier: spec.tier,
      active: true,
      phone: `(419) ${exchange}-${line}`,
      redtailId: String(48200 + i * 37),
      revenue: Math.round(tierBaseRevenue[spec.tier] * (0.8 + rand() * 0.5)),
      heldAway: i % 5 === 0,
      heldAwayNote: i % 5 === 0 ? "~$180k 401(k) still at a previous custodian." : null,
      familyId: null,
      familyRole: null,
      createdAt: `${addDays(today, oldest)}T09:00:00.000Z`,
    });

    const advisorFor = (n: number): AdvisorKey =>
      spec.advisor === "joint" ? (n % 2 === 0 ? "matt" : "advisor_b") : spec.advisor;

    const push = (type: ContactType, offset: number, n: number) => {
      const eventDate = addDays(today, offset);
      const durations: Record<ContactType, number> = {
        meeting: 45 + Math.floor(rand() * 4) * 15,
        call: 10 + Math.floor(rand() * 5) * 5,
        voicemail: 1,
        admin: 5 + Math.floor(rand() * 3) * 5,
      };
      const notesPool = type === "meeting" ? MEETING_NOTES : type === "call" ? CALL_NOTES : ADMIN_NOTES;
      events.push({
        id: `event_${clientId}_${type}_${n}`,
        clientId,
        advisor: advisorFor(n),
        type,
        eventDate,
        durationMinutes: durations[type],
        notes: rand() < 0.6 ? pick(notesPool, rand) : null,
        createdAt: `${eventDate}T16:00:00.000Z`,
      });
    };

    offsetsFor(spec.lastMeeting, model.meetingIntervalDays, spec.discipline, rand).forEach(
      (offset, n) => push("meeting", offset, n),
    );
    offsetsFor(spec.lastCall, model.callIntervalDays, spec.discipline, rand).forEach(
      (offset, n) => push("call", offset, n + 100),
    );
    if (i % 4 === 0) push("admin", -9 - (i % 3), 200);
    // A few households where we've been leaving voicemails, trying to reach them.
    if (spec.lastCall <= -90) {
      push("voicemail", -4, 300);
      push("voicemail", -11, 301);
    }
  });

  // A demo family: link the two Whitfield-adjacent S households as spouses.
  const families: Family[] = [
    { id: "family_01", name: "Whitfield Family", createdAt: `${addDays(today, -400)}T09:00:00.000Z` },
  ];
  const head = clients.find((c) => c.householdName.startsWith("Whitfield"));
  const spouse = clients.find((c) => c.householdName.startsWith("Castellanos"));
  if (head && spouse) {
    head.familyId = "family_01";
    head.familyRole = "head";
    spouse.familyId = "family_01";
    spouse.familyRole = "spouse";
  }

  const dueDates = clients.flatMap((c) =>
    computeClientDueDates(c, events, DEFAULT_SERVICE_MODELS, `${today}T06:00:00.000Z`),
  );
  const tasks = rebuildAllTasks(clients, dueDates, [], today);
  const { prospects, prospectEvents } = buildDemoProspects(today);

  return {
    users: DEMO_USERS,
    clients,
    serviceModels: DEFAULT_SERVICE_MODELS.map((m) => ({ ...m })),
    contactEvents: events,
    dueDates,
    tasks,
    prospects,
    prospectEvents,
    families,
  };
}

interface ProspectSpec {
  name: string;
  advisor: AdvisorAssignment;
  phone: string;
  status: Prospect["status"];
  nextFollowUp: number | null;
  events: Array<{ type: ProspectEvent["type"]; offset: number; notes?: string }>;
}

const PROSPECT_SPECS: ProspectSpec[] = [
  {
    name: "Sandoval, Marcus", advisor: "matt", phone: "(419) 555-0231", status: "working", nextFollowUp: 1,
    events: [
      { type: "call", offset: -2, notes: "Left a voicemail." },
      { type: "voicemail", offset: -6 },
      { type: "voicemail", offset: -12, notes: "Referred by the Whitfields." },
    ],
  },
  {
    name: "Greenfield, Tara", advisor: "advisor_b", phone: "(419) 555-0288", status: "appointment", nextFollowUp: 3,
    events: [
      { type: "meeting", offset: -1, notes: "Intro meeting booked for next week." },
      { type: "call", offset: -8, notes: "Great first conversation." },
    ],
  },
  {
    name: "Okonkwo, David", advisor: "matt", phone: "(419) 555-0265", status: "new", nextFollowUp: 0,
    events: [{ type: "note", offset: -1, notes: "Seminar lead — call this week." }],
  },
  {
    name: "Pearlman Family", advisor: "matt", phone: "(419) 555-0299", status: "working", nextFollowUp: -2,
    events: [
      { type: "voicemail", offset: -3 },
      { type: "voicemail", offset: -10 },
      { type: "email", offset: -15, notes: "Sent intro packet." },
    ],
  },
];

function buildDemoProspects(today: string): {
  prospects: Prospect[];
  prospectEvents: ProspectEvent[];
} {
  const prospects: Prospect[] = [];
  const prospectEvents: ProspectEvent[] = [];
  PROSPECT_SPECS.forEach((spec, i) => {
    const id = `prospect_${String(i + 1).padStart(2, "0")}`;
    prospects.push({
      id,
      name: spec.name,
      assignedAdvisor: spec.advisor,
      phone: spec.phone,
      status: spec.status,
      notes: null,
      nextFollowUp: spec.nextFollowUp === null ? null : addDays(today, spec.nextFollowUp),
      createdAt: `${addDays(today, -30)}T09:00:00.000Z`,
      updatedAt: `${today}T09:00:00.000Z`,
    });
    spec.events.forEach((e, n) => {
      const eventDate = addDays(today, e.offset);
      prospectEvents.push({
        id: `pevent_${id}_${n}`,
        prospectId: id,
        advisor: spec.advisor === "joint" ? "matt" : spec.advisor,
        type: e.type,
        eventDate,
        notes: e.notes ?? null,
        createdAt: `${eventDate}T15:00:00.000Z`,
      });
    });
  });
  return { prospects, prospectEvents };
}
