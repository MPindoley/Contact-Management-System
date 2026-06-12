// Supabase backend. The service engine lives in the database (see
// supabase/migrations/0001_init.sql): inserting a contact event recomputes
// due dates and rebuilds tasks via triggers, so this adapter just writes
// rows and reloads. Mutations refetch wholesale — bulletproof at Phase 1
// scale and immune to drift between app state and the database.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AddClientInput,
  AdvisorAssignment,
  AdvisorKey,
  Client,
  ContactEvent,
  ContactType,
  DataSnapshot,
  DueDate,
  LogContactInput,
  Priority,
  Role,
  ServiceModel,
  Task,
  TaskStatus,
  Tier,
  TouchType,
  UpdateClientInput,
  User,
} from "../../types";
import type { DataAdapter } from "./adapter";

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

// Tolerate the most common paste mistake (trailing slash). The value must be
// the project's base API URL: https://YOUR-REF.supabase.co
const url = rawUrl?.trim().replace(/\/+$/, "");

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * A human-readable diagnosis when VITE_SUPABASE_URL is present but wrong —
 * e.g. the dashboard page URL was pasted instead of the project API URL.
 * Shown on the sign-in screen before anyone hits a cryptic gateway error.
 */
export const supabaseConfigWarning: string | null = (() => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "supabase.com" || parsed.hostname === "www.supabase.com") {
      return "VITE_SUPABASE_URL points at the Supabase website, not your project. Use the Project URL from Project Settings → API — it looks like https://abcd1234.supabase.co — then redeploy.";
    }
    if (parsed.pathname !== "/") {
      return `VITE_SUPABASE_URL must be just the project URL with nothing after the domain (got a path: ${parsed.pathname}). Copy the Project URL from Project Settings → API, then redeploy.`;
    }
  } catch {
    return "VITE_SUPABASE_URL is not a valid URL. Copy the Project URL from Project Settings → API (https://abcd1234.supabase.co), then redeploy.";
  }
  return null;
})();

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
  client ??= createClient(url!, anonKey!);
  return client;
}

// ---------------------------------------------------------------------------
// Row mappers (snake_case DB ⇄ camelCase domain)
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  advisor_key: AdvisorKey | null;
  auth_user_id: string | null;
}
interface ClientRow {
  id: string;
  household_name: string;
  assigned_advisor: AdvisorAssignment;
  tier: Tier;
  active: boolean;
  redtail_id: string | null;
  created_at: string;
}
interface ServiceModelRow {
  tier: Tier;
  meeting_interval_days: number;
  call_interval_days: number;
}
interface ContactEventRow {
  id: string;
  client_id: string;
  advisor: AdvisorKey;
  type: ContactType;
  event_date: string;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
}
interface DueDateRow {
  id: string;
  client_id: string;
  type: TouchType;
  due_date: string;
  computed_from_event_id: string | null;
  updated_at: string;
}
interface TaskRow {
  id: string;
  client_id: string;
  type: TouchType;
  due_date: string;
  days_overdue: number;
  priority: Priority;
  status: TaskStatus;
  created_at: string;
}

const mapUser = (r: UserRow): User => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  advisorKey: r.advisor_key,
});
const mapClient = (r: ClientRow): Client => ({
  id: r.id,
  householdName: r.household_name,
  assignedAdvisor: r.assigned_advisor,
  tier: r.tier,
  active: r.active,
  redtailId: r.redtail_id,
  createdAt: r.created_at,
});
const mapModel = (r: ServiceModelRow): ServiceModel => ({
  tier: r.tier,
  meetingIntervalDays: r.meeting_interval_days,
  callIntervalDays: r.call_interval_days,
});
const mapEvent = (r: ContactEventRow): ContactEvent => ({
  id: r.id,
  clientId: r.client_id,
  advisor: r.advisor,
  type: r.type,
  eventDate: r.event_date,
  durationMinutes: r.duration_minutes,
  notes: r.notes,
  createdAt: r.created_at,
});
const mapDueDate = (r: DueDateRow): DueDate => ({
  id: r.id,
  clientId: r.client_id,
  type: r.type,
  dueDate: r.due_date,
  computedFromEventId: r.computed_from_event_id,
  updatedAt: r.updated_at,
});
const mapTask = (r: TaskRow): Task => ({
  id: r.id,
  clientId: r.client_id,
  type: r.type,
  dueDate: r.due_date,
  daysOverdue: r.days_overdue,
  priority: r.priority,
  status: r.status,
  createdAt: r.created_at,
});

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${what}: no data returned`);
  return result.data;
}

export function createSupabaseAdapter(): DataAdapter {
  const db = getSupabase();

  async function fetchSnapshot(): Promise<DataSnapshot> {
    const [users, clients, models, events, dueDates, tasks] = await Promise.all([
      db.from("users").select("*").order("name"),
      db.from("clients").select("*").order("household_name"),
      db.from("service_models").select("*").order("tier"),
      db.from("contact_events").select("*").order("event_date", { ascending: false }).limit(5000),
      db.from("due_dates").select("*"),
      db.from("tasks").select("*").order("due_date"),
    ]);

    return {
      users: unwrap<UserRow[]>(users, "Loading users").map(mapUser),
      clients: unwrap<ClientRow[]>(clients, "Loading clients").map(mapClient),
      serviceModels: unwrap<ServiceModelRow[]>(models, "Loading service models").map(mapModel),
      contactEvents: unwrap<ContactEventRow[]>(events, "Loading contact events").map(mapEvent),
      dueDates: unwrap<DueDateRow[]>(dueDates, "Loading due dates").map(mapDueDate),
      tasks: unwrap<TaskRow[]>(tasks, "Loading tasks").map(mapTask),
    };
  }

  return {
    mode: "supabase",

    load: fetchSnapshot,

    async logContact(input: LogContactInput) {
      const { error } = await db.from("contact_events").insert({
        client_id: input.clientId,
        advisor: input.advisor,
        type: input.type,
        event_date: input.eventDate,
        duration_minutes: input.durationMinutes,
        notes: input.notes?.trim() || null,
      });
      if (error) throw new Error(`Logging contact: ${error.message}`);
      return fetchSnapshot();
    },

    async addClient(input: AddClientInput) {
      const inserted = await db
        .from("clients")
        .insert({
          household_name: input.householdName.trim(),
          assigned_advisor: input.assignedAdvisor,
          tier: input.tier,
          redtail_id: input.redtailId?.trim() || null,
        })
        .select("id")
        .single();
      const { id } = unwrap<{ id: string }>(inserted, "Adding client");

      const seedAdvisor = input.assignedAdvisor === "joint" ? "matt" : input.assignedAdvisor;
      const seeds = [
        input.lastMeetingDate && { type: "meeting" as const, event_date: input.lastMeetingDate },
        input.lastCallDate && { type: "call" as const, event_date: input.lastCallDate },
      ].filter(Boolean) as Array<{ type: TouchType; event_date: string }>;

      if (seeds.length > 0) {
        const { error } = await db.from("contact_events").insert(
          seeds.map((s) => ({
            client_id: id,
            advisor: seedAdvisor,
            type: s.type,
            event_date: s.event_date,
            notes: "Logged while adding the household.",
          })),
        );
        if (error) throw new Error(`Seeding contact history: ${error.message}`);
      }
      return fetchSnapshot();
    },

    async updateClient(clientId: string, patch: UpdateClientInput) {
      const row: Record<string, unknown> = {};
      if (patch.householdName !== undefined) row.household_name = patch.householdName.trim();
      if (patch.assignedAdvisor !== undefined) row.assigned_advisor = patch.assignedAdvisor;
      if (patch.tier !== undefined) row.tier = patch.tier;
      if (patch.active !== undefined) row.active = patch.active;

      const { error } = await db.from("clients").update(row).eq("id", clientId);
      if (error) throw new Error(`Updating client: ${error.message}`);
      return fetchSnapshot();
    },

    async updateServiceModel(model: ServiceModel) {
      // The service_models trigger recomputes every due date and task.
      const { error } = await db
        .from("service_models")
        .update({
          meeting_interval_days: model.meetingIntervalDays,
          call_interval_days: model.callIntervalDays,
        })
        .eq("tier", model.tier);
      if (error) throw new Error(`Updating service model: ${error.message}`);
      return fetchSnapshot();
    },

    async rebuildQueue() {
      const { error } = await db.rpc("rebuild_tasks");
      if (error) throw new Error(`Rebuilding queue: ${error.message}`);
      return fetchSnapshot();
    },
  };
}
