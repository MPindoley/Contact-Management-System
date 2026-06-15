// Domain types shared across the app. Dates are ISO `YYYY-MM-DD` strings;
// timestamps are ISO datetime strings.

export type Tier = "A" | "B" | "C";
export type AdvisorAssignment = "matt" | "advisor_b" | "joint";
export type AdvisorKey = Exclude<AdvisorAssignment, "joint">;
export type Role = "advisor" | "assistant";
export type ContactType = "meeting" | "call" | "admin";
export type TouchType = "meeting" | "call";
export type Priority = "high" | "medium" | "low";
export type TaskStatus = "open" | "done";

export interface User {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  advisorKey: AdvisorKey | null; // null for the assistant
}

export interface Client {
  id: string;
  householdName: string;
  assignedAdvisor: AdvisorAssignment;
  tier: Tier;
  active: boolean;
  redtailId: string | null;
  createdAt: string;
}

export interface ServiceModel {
  tier: Tier;
  meetingIntervalDays: number;
  callIntervalDays: number;
}

export interface ContactEvent {
  id: string;
  clientId: string;
  advisor: AdvisorKey;
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

export interface DataSnapshot {
  users: User[];
  clients: Client[];
  serviceModels: ServiceModel[];
  contactEvents: ContactEvent[];
  dueDates: DueDate[];
  tasks: Task[];
}

export interface LogContactInput {
  clientId: string;
  advisor: AdvisorKey;
  type: ContactType;
  eventDate: string;
  durationMinutes: number | null;
  notes: string | null;
}

export interface UpdateContactInput {
  advisor?: AdvisorKey;
  type?: ContactType;
  eventDate?: string;
  durationMinutes?: number | null;
  notes?: string | null;
}

export interface AddClientInput {
  householdName: string;
  assignedAdvisor: AdvisorAssignment;
  tier: Tier;
  redtailId: string | null;
  // Seeds the service clock — "when did you last actually touch this client?"
  lastMeetingDate: string | null;
  lastCallDate: string | null;
}

export interface UpdateClientInput {
  householdName?: string;
  assignedAdvisor?: AdvisorAssignment;
  tier?: Tier;
  active?: boolean;
}

export const ADVISOR_LABELS: Record<AdvisorAssignment, string> = {
  matt: "Matt",
  advisor_b: "Beau",
  joint: "Joint",
};

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  meeting: "Meeting",
  call: "Meaningful Call",
  admin: "Admin",
};

export const TOUCH_TYPE_LABELS: Record<TouchType, string> = {
  meeting: "Meeting",
  call: "Call",
};

export const TIERS: Tier[] = ["A", "B", "C"];
export const ADVISOR_KEYS: AdvisorKey[] = ["matt", "advisor_b"];

/** The advisor assignments a user is responsible for (their default scope). */
export function scopeFor(user: User): AdvisorAssignment[] | "all" {
  if (user.role === "assistant" || !user.advisorKey) return "all";
  return [user.advisorKey, "joint"];
}

export function clientInScope(client: Client, scope: AdvisorAssignment[] | "all"): boolean {
  return scope === "all" || scope.includes(client.assignedAdvisor);
}
