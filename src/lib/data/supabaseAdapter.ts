// Supabase backend. The service engine lives in the database (see
// supabase/migrations/0001_init.sql): inserting a contact event recomputes
// due dates and rebuilds tasks via triggers, so this adapter just writes
// rows and reloads. Mutations refetch wholesale — bulletproof at Phase 1
// scale and immune to drift between app state and the database.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AddClientInput,
  AddProspectInput,
  AdvisorAssignment,
  AdvisorKey,
  Client,
  ContactEvent,
  ContactType,
  DataSnapshot,
  DueDate,
  Family,
  FamilyRole,
  LogContactInput,
  LogProspectInput,
  Priority,
  Prospect,
  ProspectEvent,
  ProspectEventType,
  ProspectStatus,
  Role,
  ServiceModel,
  Task,
  TaskStatus,
  Tier,
  TouchType,
  UpdateClientInput,
  UpdateContactInput,
  UpdateProspectInput,
  User,
} from "../../types";
import type { DataAdapter } from "./adapter";
import { surnameOf } from "../importCsv";

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
  phone: string | null;
  redtail_id: string | null;
  revenue: number | null;
  held_away: boolean;
  held_away_note: string | null;
  family_id: string | null;
  family_role: FamilyRole | null;
  created_at: string;
}
interface FamilyRow {
  id: string;
  name: string;
  created_at: string;
}
interface ServiceModelRow {
  tier: Tier;
  meeting_interval_days: number;
  call_interval_days: number;
  min_revenue: number | null;
  description: string | null;
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
  snoozed_until: string | null;
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
  phone: r.phone,
  redtailId: r.redtail_id,
  revenue: r.revenue ?? null,
  heldAway: r.held_away ?? false,
  heldAwayNote: r.held_away_note,
  familyId: r.family_id ?? null,
  familyRole: r.family_role ?? null,
  createdAt: r.created_at,
});
const mapFamily = (r: FamilyRow): Family => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
});
const mapModel = (r: ServiceModelRow): ServiceModel => ({
  tier: r.tier,
  meetingIntervalDays: r.meeting_interval_days,
  callIntervalDays: r.call_interval_days,
  minRevenue: r.min_revenue,
  description: r.description,
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
  snoozedUntil: r.snoozed_until,
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

interface ProspectRow {
  id: string;
  name: string;
  assigned_advisor: AdvisorAssignment;
  phone: string | null;
  status: ProspectStatus;
  notes: string | null;
  next_follow_up: string | null;
  created_at: string;
  updated_at: string;
}
interface ProspectEventRow {
  id: string;
  prospect_id: string;
  advisor: AdvisorKey;
  type: ProspectEventType;
  event_date: string;
  notes: string | null;
  created_at: string;
}

const mapProspect = (r: ProspectRow): Prospect => ({
  id: r.id,
  name: r.name,
  assignedAdvisor: r.assigned_advisor,
  phone: r.phone,
  status: r.status,
  notes: r.notes,
  nextFollowUp: r.next_follow_up,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const mapProspectEvent = (r: ProspectEventRow): ProspectEvent => ({
  id: r.id,
  prospectId: r.prospect_id,
  advisor: r.advisor,
  type: r.type,
  eventDate: r.event_date,
  notes: r.notes,
  createdAt: r.created_at,
});

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${what}: no data returned`);
  return result.data;
}

export function createSupabaseAdapter(): DataAdapter {
  const db = getSupabase();

  /** Delete family rows that no longer have any members. */
  async function pruneEmptyFamilies(): Promise<void> {
    const fams = await db.from("families").select("id");
    const used = await db.from("clients").select("family_id").not("family_id", "is", null);
    const usedIds = new Set((used.data ?? []).map((r: { family_id: string | null }) => r.family_id));
    const empty = (fams.data ?? []).map((r: { id: string }) => r.id).filter((id: string) => !usedIds.has(id));
    if (empty.length > 0) await db.from("families").delete().in("id", empty);
  }

  async function fetchSnapshot(): Promise<DataSnapshot> {
    const [users, clients, models, events, dueDates, tasks, prospects, prospectEvents, families] =
      await Promise.all([
        db.from("users").select("*").order("name"),
        db.from("clients").select("*").order("household_name"),
        db.from("service_models").select("*").order("tier"),
        db.from("contact_events").select("*").order("event_date", { ascending: false }).limit(5000),
        db.from("due_dates").select("*"),
        db.from("tasks").select("*").order("due_date"),
        db.from("prospects").select("*").order("name"),
        db.from("prospect_events").select("*").order("event_date", { ascending: false }).limit(5000),
        db.from("families").select("*").order("name"),
      ]);

    return {
      users: unwrap<UserRow[]>(users, "Loading users").map(mapUser),
      clients: unwrap<ClientRow[]>(clients, "Loading clients").map(mapClient),
      serviceModels: unwrap<ServiceModelRow[]>(models, "Loading service models").map(mapModel),
      contactEvents: unwrap<ContactEventRow[]>(events, "Loading contact events").map(mapEvent),
      dueDates: unwrap<DueDateRow[]>(dueDates, "Loading due dates").map(mapDueDate),
      tasks: unwrap<TaskRow[]>(tasks, "Loading tasks").map(mapTask),
      prospects: unwrap<ProspectRow[]>(prospects, "Loading prospects").map(mapProspect),
      prospectEvents: unwrap<ProspectEventRow[]>(prospectEvents, "Loading prospect events").map(
        mapProspectEvent,
      ),
      families: unwrap<FamilyRow[]>(families, "Loading families").map(mapFamily),
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
          phone: input.phone?.trim() || null,
          redtail_id: input.redtailId?.trim() || null,
          revenue: input.revenue,
          held_away: input.heldAway,
          held_away_note: input.heldAwayNote?.trim() || null,
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

    async importClients(inputs: AddClientInput[], updates: Array<{ id: string; patch: UpdateClientInput }> = []) {
      // Chunked bulk inserts; the database triggers compute due dates and
      // tasks per row, so the queue is live the moment this resolves.
      const CHUNK = 100;
      for (let i = 0; i < inputs.length; i += CHUNK) {
        const chunk = inputs.slice(i, i + CHUNK);
        const inserted = await db
          .from("clients")
          .insert(
            chunk.map((c) => ({
              household_name: c.householdName.trim(),
              assigned_advisor: c.assignedAdvisor,
              tier: c.tier,
              phone: c.phone?.trim() || null,
              redtail_id: c.redtailId?.trim() || null,
              revenue: c.revenue,
              held_away: c.heldAway,
              held_away_note: c.heldAwayNote?.trim() || null,
            })),
          )
          .select("id");
        const ids = unwrap<Array<{ id: string }>>(inserted, "Importing clients");

        const events = chunk.flatMap((c, j) => {
          const seedAdvisor = c.assignedAdvisor === "joint" ? "matt" : c.assignedAdvisor;
          return [
            c.lastMeetingDate && {
              client_id: ids[j].id,
              advisor: seedAdvisor,
              type: "meeting" as const,
              event_date: c.lastMeetingDate,
              notes: "Imported from CSV.",
            },
            c.lastCallDate && {
              client_id: ids[j].id,
              advisor: seedAdvisor,
              type: "call" as const,
              event_date: c.lastCallDate,
              notes: "Imported from CSV.",
            },
          ].filter(Boolean) as Array<Record<string, unknown>>;
        });

        if (events.length > 0) {
          const { error } = await db.from("contact_events").insert(events);
          if (error) throw new Error(`Importing contact history: ${error.message}`);
        }
      }

      // Reconcile existing households — client fields only. The tier-change
      // trigger reflows due dates; contact history is never touched.
      for (const { id, patch } of updates) {
        const row: Record<string, unknown> = {};
        if (patch.householdName !== undefined) row.household_name = patch.householdName.trim();
        if (patch.assignedAdvisor !== undefined) row.assigned_advisor = patch.assignedAdvisor;
        if (patch.tier !== undefined) row.tier = patch.tier;
        if (patch.active !== undefined) row.active = patch.active;
        if (patch.phone !== undefined) row.phone = patch.phone?.trim() || null;
      if (patch.revenue !== undefined) row.revenue = patch.revenue;
      if (patch.familyId !== undefined) row.family_id = patch.familyId;
      if (patch.familyRole !== undefined) row.family_role = patch.familyRole;
        if (patch.revenue !== undefined) row.revenue = patch.revenue;
        if (patch.familyId !== undefined) row.family_id = patch.familyId;
        if (patch.familyRole !== undefined) row.family_role = patch.familyRole;
        if (patch.heldAway !== undefined) row.held_away = patch.heldAway;
        if (patch.heldAwayNote !== undefined) row.held_away_note = patch.heldAwayNote?.trim() || null;
        if (Object.keys(row).length === 0) continue;
        const { error } = await db.from("clients").update(row).eq("id", id);
        if (error) throw new Error(`Updating ${id}: ${error.message}`);
      }
      return fetchSnapshot();
    },

    async updateContactEvent(eventId: string, patch: UpdateContactInput) {
      const row: Record<string, unknown> = {};
      if (patch.advisor !== undefined) row.advisor = patch.advisor;
      if (patch.type !== undefined) row.type = patch.type;
      if (patch.eventDate !== undefined) row.event_date = patch.eventDate;
      if (patch.durationMinutes !== undefined) row.duration_minutes = patch.durationMinutes;
      if (patch.notes !== undefined) row.notes = patch.notes?.trim() || null;

      const { error } = await db.from("contact_events").update(row).eq("id", eventId);
      if (error) throw new Error(`Updating contact: ${error.message}`);
      return fetchSnapshot();
    },

    async deleteContactEvent(eventId: string) {
      const { error } = await db.from("contact_events").delete().eq("id", eventId);
      if (error) throw new Error(`Deleting contact: ${error.message}`);
      return fetchSnapshot();
    },

    async snoozeTouch(clientId: string, type: TouchType, untilDate: string | null) {
      const { error } = await db.rpc("snooze_touch", {
        p_client: clientId,
        p_type: type,
        p_until: untilDate,
      });
      if (error) throw new Error(`Snoozing: ${error.message}`);
      return fetchSnapshot();
    },

    async planOutreach(items: Array<{ clientId: string; dueDate: string }>) {
      const { error } = await db.rpc("plan_outreach", {
        p_items: items.map((i) => ({ client_id: i.clientId, due_date: i.dueDate })),
      });
      if (error) throw new Error(`Planning outreach: ${error.message}`);
      return fetchSnapshot();
    },

    async updateClient(clientId: string, patch: UpdateClientInput) {
      const row: Record<string, unknown> = {};
      if (patch.householdName !== undefined) row.household_name = patch.householdName.trim();
      if (patch.assignedAdvisor !== undefined) row.assigned_advisor = patch.assignedAdvisor;
      if (patch.tier !== undefined) row.tier = patch.tier;
      if (patch.active !== undefined) row.active = patch.active;
      if (patch.phone !== undefined) row.phone = patch.phone?.trim() || null;
      if (patch.revenue !== undefined) row.revenue = patch.revenue;
      if (patch.familyId !== undefined) row.family_id = patch.familyId;
      if (patch.familyRole !== undefined) row.family_role = patch.familyRole;
      if (patch.heldAway !== undefined) row.held_away = patch.heldAway;
      if (patch.heldAwayNote !== undefined) row.held_away_note = patch.heldAwayNote?.trim() || null;

      const { error } = await db.from("clients").update(row).eq("id", clientId);
      if (error) throw new Error(`Updating client: ${error.message}`);
      return fetchSnapshot();
    },

    async deleteClient(clientId: string) {
      // contact_events, due_dates and tasks cascade-delete in the database.
      const { error } = await db.from("clients").delete().eq("id", clientId);
      if (error) throw new Error(`Deleting client: ${error.message}`);
      await pruneEmptyFamilies();
      return fetchSnapshot();
    },

    // --- Family linking ---
    async linkFamily(
      clientIds: string[],
      familyId: string | null,
      name: string | null,
      roles: Record<string, FamilyRole> = {},
    ) {
      let fid = familyId;
      if (!fid) {
        const inserted = await db
          .from("families")
          .insert({ name: name?.trim() || "New Family" })
          .select("id")
          .single();
        fid = unwrap<{ id: string }>(inserted, "Creating family").id;
      }
      for (const id of clientIds) {
        const row: Record<string, unknown> = { family_id: fid };
        if (roles[id]) row.family_role = roles[id];
        const { error } = await db.from("clients").update(row).eq("id", id);
        if (error) throw new Error(`Linking family: ${error.message}`);
      }
      // Default a role for any member that still has none.
      await db.from("clients").update({ family_role: "other" }).eq("family_id", fid).is("family_role", null);
      await pruneEmptyFamilies();
      return fetchSnapshot();
    },

    async unlinkFromFamily(clientId: string) {
      const { error } = await db
        .from("clients")
        .update({ family_id: null, family_role: null })
        .eq("id", clientId);
      if (error) throw new Error(`Unlinking family: ${error.message}`);
      await pruneEmptyFamilies();
      return fetchSnapshot();
    },

    async renameFamily(familyId: string, name: string) {
      const { error } = await db.from("families").update({ name: name.trim() }).eq("id", familyId);
      if (error) throw new Error(`Renaming family: ${error.message}`);
      return fetchSnapshot();
    },

    async autoLinkBySurname() {
      const res = await db.from("clients").select("id, household_name, family_id");
      const rows = unwrap<Array<{ id: string; household_name: string; family_id: string | null }>>(
        res,
        "Loading clients",
      );
      const groups = new Map<string, string[]>();
      for (const r of rows) {
        if (r.family_id) continue;
        const sn = surnameOf(r.household_name);
        if (!sn) continue;
        const g = groups.get(sn);
        if (g) g.push(r.id);
        else groups.set(sn, [r.id]);
      }
      for (const [sn, ids] of groups) {
        if (ids.length < 2) continue;
        const display = sn.charAt(0).toUpperCase() + sn.slice(1);
        const inserted = await db.from("families").insert({ name: `${display} Family` }).select("id").single();
        const fid = unwrap<{ id: string }>(inserted, "Creating family").id;
        await db.from("clients").update({ family_id: fid, family_role: "head" }).eq("id", ids[0]);
        for (const id of ids.slice(1)) {
          await db.from("clients").update({ family_id: fid, family_role: "other" }).eq("id", id);
        }
      }
      return fetchSnapshot();
    },

    async updateServiceModel(model: ServiceModel) {
      // The service_models trigger recomputes every due date and task.
      const { error } = await db
        .from("service_models")
        .update({
          meeting_interval_days: model.meetingIntervalDays,
          call_interval_days: model.callIntervalDays,
          min_revenue: model.minRevenue,
          description: model.description?.trim() || null,
        })
        .eq("tier", model.tier);
      if (error) throw new Error(`Updating service model: ${error.message}`);
      return fetchSnapshot();
    },

    // --- Prospects ---
    async addProspect(input: AddProspectInput) {
      const { error } = await db.from("prospects").insert({
        name: input.name.trim(),
        assigned_advisor: input.assignedAdvisor,
        phone: input.phone?.trim() || null,
        status: input.status,
        notes: input.notes?.trim() || null,
        next_follow_up: input.nextFollowUp || null,
      });
      if (error) throw new Error(`Adding prospect: ${error.message}`);
      return fetchSnapshot();
    },

    async updateProspect(prospectId: string, patch: UpdateProspectInput) {
      const row: Record<string, unknown> = {};
      if (patch.name !== undefined) row.name = patch.name.trim();
      if (patch.assignedAdvisor !== undefined) row.assigned_advisor = patch.assignedAdvisor;
      if (patch.phone !== undefined) row.phone = patch.phone?.trim() || null;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.notes !== undefined) row.notes = patch.notes?.trim() || null;
      if (patch.nextFollowUp !== undefined) row.next_follow_up = patch.nextFollowUp || null;

      const { error } = await db.from("prospects").update(row).eq("id", prospectId);
      if (error) throw new Error(`Updating prospect: ${error.message}`);
      return fetchSnapshot();
    },

    async deleteProspect(prospectId: string) {
      const { error } = await db.from("prospects").delete().eq("id", prospectId);
      if (error) throw new Error(`Deleting prospect: ${error.message}`);
      return fetchSnapshot();
    },

    async logProspectContact(input: LogProspectInput) {
      const { error } = await db.from("prospect_events").insert({
        prospect_id: input.prospectId,
        advisor: input.advisor,
        type: input.type,
        event_date: input.eventDate,
        notes: input.notes?.trim() || null,
      });
      if (error) throw new Error(`Logging prospect contact: ${error.message}`);

      const row: Record<string, unknown> = {};
      if (input.nextFollowUp !== undefined) row.next_follow_up = input.nextFollowUp || null;
      if (Object.keys(row).length > 0) {
        await db.from("prospects").update(row).eq("id", input.prospectId);
      }
      return fetchSnapshot();
    },

    async deleteProspectEvent(eventId: string) {
      const { error } = await db.from("prospect_events").delete().eq("id", eventId);
      if (error) throw new Error(`Deleting prospect contact: ${error.message}`);
      return fetchSnapshot();
    },

    async rebuildQueue() {
      const { error } = await db.rpc("rebuild_tasks");
      if (error) throw new Error(`Rebuilding queue: ${error.message}`);
      return fetchSnapshot();
    },
  };
}
