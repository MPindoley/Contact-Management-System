// Domain types shared across the app. Dates are ISO `YYYY-MM-DD` strings;
// timestamps are ISO datetime strings.

// Tiers, top to bottom: S (the very top) → A → B → C.
export type Tier = "S" | "A" | "B" | "C";
export type FamilyRole = "head" | "spouse" | "partner" | "child" | "grandchild" | "parent" | "sibling" | "other";
export type AdvisorAssignment = "matt" | "advisor_b" | "joint";
export type AdvisorKey = Exclude<AdvisorAssignment, "joint">;
export type Role = "advisor" | "assistant";
/**
 * Who made/logged a touch — the two advisors plus the assistant. Kept separate
 * from AdvisorKey (advisors only) and AdvisorAssignment (client ownership) so
 * "assistant" can author a contact without ever becoming a client-assignment
 * option.
 */
export type TouchAuthor = AdvisorKey | "assistant";
export type ContactType = "meeting" | "call" | "voicemail" | "admin";
export type TouchType = "meeting" | "call";
export type Priority = "high" | "medium" | "low";
export type TaskStatus = "open" | "done";

/**
 * An opportunity tag on a household — "there's a Roth conversion here", "they
 * need long-term care". Just the id: the label and the keywords that suggest it
 * live in a ClientTagDef row, so the firm can add its own without a code change.
 *
 * A plain string rather than a union for exactly that reason. Anything reading a
 * tag has to tolerate an id it has no definition for (one deleted on another
 * device, say) — tagLabel() below is the single place that decides what to show.
 */
export type ClientTag = string;

/**
 * The definition of an opportunity tag. Firm-wide config, like service models:
 * editable in the app, stored in the database, seeded with the ten the firm
 * started with.
 */
export interface ClientTagDef {
  /** Slug stored on clients.tags. Never changes once created. */
  id: ClientTag;
  label: string;
  /**
   * Phrases that imply this tag when they appear in a dictated note. Lower
   * case; matched on word boundaries. Empty means "never suggest, only tick
   * by hand".
   */
  keywords: string[];
  /** Position in the picker and in suggestion output. */
  sortOrder: number;
}

export interface User {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  advisorKey: AdvisorKey | null; // null for the assistant
  /** Can see every advisor's clients (e.g. the senior advisor + assistant). */
  seesAllBooks: boolean;
}

export interface Client {
  id: string;
  householdName: string;
  assignedAdvisor: AdvisorAssignment;
  tier: Tier;
  active: boolean;
  phone: string | null;
  redtailId: string | null;
  /** Managed assets / revenue (AUM). Drives tiering and family combined totals. */
  revenue: number | null;
  /** "There's money out there to capture" — held-away assets / money due. */
  heldAway: boolean;
  heldAwayNote: string | null;
  /** Family link — multiple households grouped (spouses, parents, kids…). */
  familyId: string | null;
  familyRole: FamilyRole | null;
  /**
   * Does a touch logged for this family land on this household too? True for
   * everyone by default. Turn it off for the member who genuinely isn't in the
   * room -- a child, a trust, an old account kept for one holding -- so their
   * clock isn't reset by a meeting they weren't at. A standing rule, not a
   * lock: Log Contact still lists them, just switched off.
   */
  mirrorTouches: boolean;
  /** Opportunity tags (Roth conversion, side fund…). Searchable and filterable. */
  tags: ClientTag[];
  /**
   * A booked upcoming meeting. It keeps the meeting off the queue until that
   * day (so the app stops asking for something already on the calendar), but
   * it is never a completed touch: the service score only moves when the
   * meeting actually happens and gets logged.
   */
  nextMeetingDate: string | null;
  nextMeetingNote: string | null;
  createdAt: string;
}

export interface Family {
  id: string;
  name: string;
  createdAt: string;
  /**
   * Members sitting in another advisor's book, invisible to the current user.
   * Set by scopeSnapshot so a family that has been narrowed down never renders
   * as though it were complete. Undefined means none were hidden.
   */
  hiddenMembers?: number;
}

export interface ServiceModel {
  tier: Tier;
  meetingIntervalDays: number;
  callIntervalDays: number;
  /** The criteria that define this tier — editable as the book grows. */
  minRevenue: number | null;
  description: string | null;
}

export interface ContactEvent {
  id: string;
  clientId: string;
  advisor: TouchAuthor;
  type: ContactType;
  eventDate: string;
  durationMinutes: number | null;
  notes: string | null;
  /**
   * One conversation covering several households in a family gets one row per
   * household — their service clocks are separate — and they all share this id.
   * Null for an ordinary single-household touch.
   */
  groupId: string | null;
  createdAt: string;
}

export interface DueDate {
  id: string;
  clientId: string;
  type: TouchType;
  dueDate: string;
  computedFromEventId: string | null;
  /** Workflow overlay: suppress this touch from the queue until this date. */
  snoozedUntil: string | null;
  updatedAt: string;
}

export interface Task {
  id: string;
  clientId: string;
  type: TouchType;
  dueDate: string;
  daysOverdue: number;
  priority: Priority;
  status: TaskStatus;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Prospects — a separate island for not-yet-clients. None of this feeds the
// service engine, scores, or the firm report.
// ---------------------------------------------------------------------------

export type ProspectStatus = "new" | "working" | "appointment" | "converted" | "lost";
export type ProspectEventType = "call" | "voicemail" | "meeting" | "email" | "note";

export interface Prospect {
  id: string;
  name: string;
  assignedAdvisor: AdvisorAssignment;
  phone: string | null;
  status: ProspectStatus;
  notes: string | null;
  nextFollowUp: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProspectEvent {
  id: string;
  prospectId: string;
  advisor: TouchAuthor;
  type: ProspectEventType;
  eventDate: string;
  notes: string | null;
  createdAt: string;
}

export interface DataSnapshot {
  users: User[];
  clients: Client[];
  serviceModels: ServiceModel[];
  contactEvents: ContactEvent[];
  dueDates: DueDate[];
  tasks: Task[];
  prospects: Prospect[];
  prospectEvents: ProspectEvent[];
  families: Family[];
  clientTags: ClientTagDef[];
}

export interface AddProspectInput {
  name: string;
  assignedAdvisor: AdvisorAssignment;
  phone: string | null;
  status: ProspectStatus;
  notes: string | null;
  nextFollowUp: string | null;
}

export interface UpdateProspectInput {
  name?: string;
  assignedAdvisor?: AdvisorAssignment;
  phone?: string | null;
  status?: ProspectStatus;
  notes?: string | null;
  nextFollowUp?: string | null;
}

export interface LogProspectInput {
  prospectId: string;
  advisor: TouchAuthor;
  type: ProspectEventType;
  eventDate: string;
  notes: string | null;
  /** Optionally move the next-follow-up date in the same action. */
  nextFollowUp?: string | null;
}

export const PROSPECT_STATUS_LABELS: Record<ProspectStatus, string> = {
  new: "New",
  working: "Working",
  appointment: "Appointment set",
  converted: "Converted",
  lost: "Lost",
};

export const PROSPECT_EVENT_LABELS: Record<ProspectEventType, string> = {
  call: "Call",
  voicemail: "Voicemail",
  meeting: "Meeting",
  email: "Email",
  note: "Note",
};

export const PROSPECT_STATUSES: ProspectStatus[] = [
  "new",
  "working",
  "appointment",
  "converted",
  "lost",
];

export interface LogContactInput {
  clientId: string;
  advisor: TouchAuthor;
  type: ContactType;
  eventDate: string;
  durationMinutes: number | null;
  notes: string | null;
  /**
   * Other households in the same family this touch also covers — a joint
   * review is one meeting, but each household keeps its own clock, so each
   * gets its own event row tied to the others by a shared group id.
   */
  alsoForClientIds?: string[];
}

export interface UpdateContactInput {
  advisor?: TouchAuthor;
  type?: ContactType;
  eventDate?: string;
  durationMinutes?: number | null;
  notes?: string | null;
}

export interface AddClientTagInput {
  label: string;
  keywords: string[];
}

export interface UpdateClientTagInput {
  label?: string;
  keywords?: string[];
  sortOrder?: number;
}

export interface AddClientInput {
  householdName: string;
  assignedAdvisor: AdvisorAssignment;
  tier: Tier;
  phone: string | null;
  redtailId: string | null;
  revenue: number | null;
  heldAway: boolean;
  heldAwayNote: string | null;
  tags: ClientTag[];
  // Seeds the service clock — "when did you last actually touch this client?"
  lastMeetingDate: string | null;
  lastCallDate: string | null;
}

export interface UpdateClientInput {
  householdName?: string;
  assignedAdvisor?: AdvisorAssignment;
  tier?: Tier;
  active?: boolean;
  phone?: string | null;
  revenue?: number | null;
  heldAway?: boolean;
  heldAwayNote?: string | null;
  familyId?: string | null;
  familyRole?: FamilyRole | null;
  mirrorTouches?: boolean;
  tags?: ClientTag[];
  nextMeetingDate?: string | null;
  nextMeetingNote?: string | null;
}

export const FAMILY_ROLE_LABELS: Record<FamilyRole, string> = {
  head: "Head",
  spouse: "Spouse",
  partner: "Partner",
  child: "Child",
  grandchild: "Grandchild",
  parent: "Parent",
  sibling: "Sibling",
  other: "Other",
};

export const FAMILY_ROLES: FamilyRole[] = [
  "head",
  "spouse",
  "partner",
  "child",
  "grandchild",
  "parent",
  "sibling",
  "other",
];

export const ADVISOR_LABELS: Record<AdvisorAssignment, string> = {
  matt: "Matt",
  advisor_b: "Beau",
  joint: "Joint",
};

/**
 * The tags every firm starts with, and the phrases that suggest them. Seeded
 * into the database on first run and fully editable from then on — this array
 * is a starting point, not the canonical list. The canonical list is whatever
 * is in `client_tags`.
 *
 * The ids must never change: they are what is already stored on clients.tags.
 */
export const DEFAULT_CLIENT_TAGS: ClientTagDef[] = [
  {
    id: "roth_conversion",
    label: "Roth Conversion",
    // Deliberately NOT a bare "roth" — that belongs to the Roth IRA tag, and
    // the suggester's specificity rule keeps the longer phrase from dragging
    // the shorter one in with it.
    keywords: ["roth conversion", "convert to roth", "converting to roth", "backdoor roth"],
    sortOrder: 0,
  },
  {
    id: "roth_ira",
    label: "Roth IRA",
    keywords: [
      "roth", "roth ira", "roth contribution", "fund the roth", "max out the roth",
      "contribute to the roth", "roth limit",
    ],
    sortOrder: 1,
  },
  { id: "side_fund", label: "Side Fund", keywords: ["side fund", "side account", "side money", "sidefund"], sortOrder: 2 },
  {
    id: "ltc_insurance",
    label: "Long-Term Care Insurance",
    keywords: ["long term care", "long-term care", "ltc", "nursing home", "home health care"],
    sortOrder: 3,
  },
  {
    id: "money_due",
    label: "Money Due",
    keywords: [
      "money due", "money owed", "held away", "held-away", "outside money",
      "money to capture", "old 401k", "old 401(k)", "orphan account",
    ],
    sortOrder: 4,
  },
  {
    id: "life_insurance",
    label: "Life Insurance",
    keywords: ["life insurance", "term life", "whole life", "death benefit", "iul"],
    sortOrder: 5,
  },
  {
    id: "college_529",
    label: "529 / College Funding",
    keywords: ["529", "college fund", "college savings", "tuition", "education savings"],
    sortOrder: 6,
  },
  {
    id: "estate_beneficiary",
    label: "Estate / Beneficiary Review",
    keywords: [
      "estate plan", "estate planning", "beneficiary", "beneficiaries",
      "living trust", "revocable trust", "power of attorney", "will update", "update the will",
    ],
    sortOrder: 7,
  },
  {
    id: "tax_planning",
    label: "Tax Planning",
    keywords: [
      "tax planning", "tax strategy", "capital gains", "tax loss", "tax-loss",
      "harvest", "cpa", "taxable income", "bracket",
    ],
    sortOrder: 8,
  },
  { id: "annuity_review", label: "Annuity Review", keywords: ["annuity", "annuities"], sortOrder: 9 },
  { id: "rmd", label: "RMD", keywords: ["rmd", "required minimum", "required minimum distribution"], sortOrder: 10 },
];

/** Definitions in display order. */
export function sortedTags(defs: ClientTagDef[]): ClientTagDef[] {
  return [...defs].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

/**
 * What to show for a tag id. A household can carry an id whose definition was
 * deleted on another device, so rather than render blank we humanise the slug:
 * "roth_ira" reads as "Roth Ira", which is recognisable enough to fix.
 */
export function tagLabel(defs: ClientTagDef[], id: ClientTag): string {
  const found = defs.find((d) => d.id === id);
  if (found) return found.label;
  return id
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Turn a label into an id: "Roth IRA" -> "roth_ira". */
export function slugifyTag(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/** Does this household match a free-text search of its tags? */
export function clientMatchesTagSearch(
  tags: ClientTag[],
  query: string,
  defs: ClientTagDef[],
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return tags.some((t) => tagLabel(defs, t).toLowerCase().includes(q));
}

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  meeting: "Meeting",
  call: "Meaningful Call",
  voicemail: "Voicemail",
  admin: "Admin",
};

/**
 * Only meetings and meaningful calls drive the service engine — due dates,
 * tasks, scores, "last contact", outreach. Voicemails and admin touches are
 * tracked for the record but never move the clock or the graphs.
 */
export function isMeaningfulContact(type: ContactType): boolean {
  return type === "meeting" || type === "call";
}

export const TOUCH_TYPE_LABELS: Record<TouchType, string> = {
  meeting: "Meeting",
  call: "Call",
};

export const TIERS: Tier[] = ["S", "A", "B", "C"];
/** Sort rank, best first. Use everywhere tiers are ordered. */
export const TIER_RANK: Record<Tier, number> = { S: 0, A: 1, B: 2, C: 3 };
export const ADVISOR_KEYS: AdvisorKey[] = ["matt", "advisor_b"];

// Who can be recorded as making a touch — both advisors and the assistant.
export const TOUCH_AUTHORS: TouchAuthor[] = ["matt", "advisor_b", "assistant"];
export const TOUCH_AUTHOR_LABELS: Record<TouchAuthor, string> = {
  matt: "Matt",
  advisor_b: "Beau",
  assistant: "Carolyn",
};

/** The touch author to default to for a user (the assistant logs as herself). */
export function authorForUser(user: User | null): TouchAuthor {
  if (!user) return "matt";
  if (user.role === "assistant") return "assistant";
  return user.advisorKey ?? "matt";
}

/** The advisor assignments a user is responsible for (their default scope). */
export function scopeFor(user: User): AdvisorAssignment[] | "all" {
  if (user.role === "assistant" || !user.advisorKey) return "all";
  return [user.advisorKey, "joint"];
}

export function clientInScope(client: Client, scope: AdvisorAssignment[] | "all"): boolean {
  return scope === "all" || scope.includes(client.assignedAdvisor);
}
