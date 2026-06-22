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
  createdAt: string;
}

export interface Family {
  id: string;
  name: string;
  createdAt: string;
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
}

export interface UpdateContactInput {
  advisor?: TouchAuthor;
  type?: ContactType;
  eventDate?: string;
  durationMinutes?: number | null;
  notes?: string | null;
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
