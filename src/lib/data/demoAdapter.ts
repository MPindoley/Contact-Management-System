// Demo backend: the full service engine running in the browser, persisted to
// localStorage. Lets the firm evaluate the entire Phase 1 workflow before a
// Supabase project exists. Swapped out automatically once
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are configured.

import type {
  AddClientInput,
  AddProspectInput,
  Client,
  ContactEvent,
  DataSnapshot,
  FamilyRole,
  LogContactInput,
  LogProspectInput,
  Prospect,
  ServiceModel,
  Tier,
  TouchType,
  UpdateClientInput,
  UpdateContactInput,
  UpdateProspectInput,
} from "../../types";
import { isMeaningfulContact } from "../../types";
import type { DataAdapter } from "./adapter";
import { todayISO } from "../dates";
import {
  computeClientDueDates,
  rebuildAllTasks,
  settleTasks,
  uid,
} from "../../engine/serviceEngine";
import { buildDemoSnapshot } from "./demoSeed";
import { surnameOf } from "../importCsv";
import { planSurnameLinks } from "../familyLink";

const STORAGE_KEY = "relationship-hub-demo-v1";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface PersistedState {
  snapshot: DataSnapshot;
  /** Date of the last simulated 6am rebuild. */
  lastRebuilt: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createDemoAdapter(storage?: StorageLike): DataAdapter {
  const store: StorageLike =
    storage ?? (typeof localStorage !== "undefined" ? localStorage : memoryStorage());

  let state: PersistedState | null = null;

  function persist(): void {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full or unavailable — demo keeps working in memory.
    }
  }

  function seed(): PersistedState {
    const today = todayISO();
    return { snapshot: buildDemoSnapshot(today), lastRebuilt: today };
  }

  function ensureLoaded(): PersistedState {
    if (state) return state;
    const raw = store.getItem(STORAGE_KEY);
    if (raw) {
      try {
        state = JSON.parse(raw) as PersistedState;
      } catch {
        state = null;
      }
    }
    if (!state || !state.snapshot?.clients?.length) {
      state = seed();
      persist();
    }
    return state;
  }

  /** Simulate the nightly cron: first load of a new day re-ages the queue. */
  function rebuildIfStale(): void {
    const s = ensureLoaded();
    const today = todayISO();
    if (s.lastRebuilt !== today) {
      rebuild(today);
    }
  }

  function rebuild(today: string): void {
    const s = ensureLoaded();
    s.snapshot.tasks = rebuildAllTasks(s.snapshot.clients, s.snapshot.dueDates, s.snapshot.tasks, today);
    s.lastRebuilt = today;
    persist();
  }

  function recomputeClient(clientId: string): void {
    const s = ensureLoaded();
    const client = s.snapshot.clients.find((c) => c.id === clientId);
    if (!client) return;
    const fresh = computeClientDueDates(client, s.snapshot.contactEvents, s.snapshot.serviceModels);
    // Preserve first-outreach placeholders (no source event) until the client
    // has been contacted for the first time; then the real cadence takes over.
    const hasContact = s.snapshot.contactEvents.some(
      (e) => e.clientId === clientId && isMeaningfulContact(e.type),
    );
    const preservedOutreach = hasContact
      ? []
      : s.snapshot.dueDates.filter(
          (d) => d.clientId === clientId && d.computedFromEventId === null,
        );
    s.snapshot.dueDates = [
      ...s.snapshot.dueDates.filter((d) => d.clientId !== clientId),
      ...fresh,
      ...preservedOutreach,
    ];
  }

  function snapshot(): DataSnapshot {
    return clone(ensureLoaded().snapshot);
  }

  /** Drop families that no longer have any members. */
  function cleanupFamilies(): void {
    const s = ensureLoaded();
    const used = new Set(s.snapshot.clients.map((c) => c.familyId).filter(Boolean));
    s.snapshot.families = s.snapshot.families.filter((f) => used.has(f.id));
  }

  /** "Whitfield Family" from the first member's surname, else "New Family". */
  function defaultFamilyName(clientIds: string[]): string {
    const s = ensureLoaded();
    const first = s.snapshot.clients.find((c) => c.id === clientIds[0]);
    const last = first ? surnameOf(first.householdName) : null;
    // Title-case the lowercased surname for display.
    const display = last ? last.charAt(0).toUpperCase() + last.slice(1) : null;
    return display ? `${display} Family` : "New Family";
  }

  return {
    mode: "demo",

    async load() {
      ensureLoaded();
      rebuildIfStale();
      return snapshot();
    },

    async logContact(input: LogContactInput) {
      const s = ensureLoaded();
      const event: ContactEvent = {
        id: uid(),
        clientId: input.clientId,
        advisor: input.advisor,
        type: input.type,
        eventDate: input.eventDate,
        durationMinutes: input.durationMinutes,
        notes: input.notes?.trim() || null,
        createdAt: new Date().toISOString(),
      };
      s.snapshot.contactEvents.push(event);

      if (isMeaningfulContact(event.type)) {
        // A meaningful touch settles the matching open task and resets the clock.
        // Voicemail / admin are tracked only — the task stays, the clock holds.
        s.snapshot.tasks = settleTasks(s.snapshot.tasks, event.clientId, event.type as "meeting" | "call");
        recomputeClient(event.clientId);
      }
      // A booked meeting that has now happened is no longer upcoming. A booking
      // further out (a different appointment) is left alone.
      if (event.type === "meeting") {
        const client = s.snapshot.clients.find((c) => c.id === event.clientId);
        if (client?.nextMeetingDate && client.nextMeetingDate <= event.eventDate) {
          client.nextMeetingDate = null;
          client.nextMeetingNote = null;
        }
      }
      rebuild(todayISO());
      return snapshot();
    },

    async addClient(input: AddClientInput) {
      const s = ensureLoaded();
      const now = new Date().toISOString();
      const client: Client = {
        id: uid(),
        householdName: input.householdName.trim(),
        assignedAdvisor: input.assignedAdvisor,
        tier: input.tier,
        active: true,
        phone: input.phone?.trim() || null,
        redtailId: input.redtailId?.trim() || null,
        revenue: input.revenue,
        heldAway: input.heldAway,
        heldAwayNote: input.heldAwayNote?.trim() || null,
        familyId: null,
        familyRole: null,
        tags: input.tags ?? [],
        nextMeetingDate: null,
        nextMeetingNote: null,
        createdAt: now,
      };
      s.snapshot.clients.push(client);

      // Seed the service clock from the real last-touch dates.
      const seedAdvisor = client.assignedAdvisor === "joint" ? "matt" : client.assignedAdvisor;
      const seeds: Array<[("meeting" | "call"), string | null]> = [
        ["meeting", input.lastMeetingDate],
        ["call", input.lastCallDate],
      ];
      for (const [type, date] of seeds) {
        if (!date) continue;
        s.snapshot.contactEvents.push({
          id: uid(),
          clientId: client.id,
          advisor: seedAdvisor,
          type,
          eventDate: date,
          durationMinutes: null,
          notes: "Logged while adding the household.",
          createdAt: now,
        });
      }

      recomputeClient(client.id);
      rebuild(todayISO());
      return snapshot();
    },

    async importClients(inputs: AddClientInput[], updates: Array<{ id: string; patch: UpdateClientInput }> = []) {
      const s = ensureLoaded();
      const now = new Date().toISOString();
      for (const input of inputs) {
        const client: Client = {
          id: uid(),
          householdName: input.householdName.trim(),
          assignedAdvisor: input.assignedAdvisor,
          tier: input.tier,
          active: true,
          phone: input.phone?.trim() || null,
          redtailId: input.redtailId?.trim() || null,
          revenue: input.revenue,
          heldAway: input.heldAway,
          heldAwayNote: input.heldAwayNote?.trim() || null,
          familyId: null,
          familyRole: null,
          tags: input.tags ?? [],
          nextMeetingDate: null,
          nextMeetingNote: null,
          createdAt: now,
        };
        s.snapshot.clients.push(client);

        const seedAdvisor = client.assignedAdvisor === "joint" ? "matt" : client.assignedAdvisor;
        const seeds: Array<[("meeting" | "call"), string | null]> = [
          ["meeting", input.lastMeetingDate],
          ["call", input.lastCallDate],
        ];
        for (const [type, date] of seeds) {
          if (!date) continue;
          s.snapshot.contactEvents.push({
            id: uid(),
            clientId: client.id,
            advisor: seedAdvisor,
            type,
            eventDate: date,
            durationMinutes: null,
            notes: "Imported from CSV.",
            createdAt: now,
          });
        }
        recomputeClient(client.id);
      }

      // Reconcile existing households — client fields only, never contacts.
      for (const { id, patch } of updates) {
        const client = s.snapshot.clients.find((c) => c.id === id);
        if (!client) continue;
        const tierChanged = patch.tier !== undefined && patch.tier !== client.tier;
        if (patch.householdName !== undefined) client.householdName = patch.householdName.trim();
        if (patch.assignedAdvisor !== undefined) client.assignedAdvisor = patch.assignedAdvisor;
        if (patch.tier !== undefined) client.tier = patch.tier;
        if (patch.active !== undefined) client.active = patch.active;
        if (patch.phone !== undefined) client.phone = patch.phone?.trim() || null;
        if (patch.revenue !== undefined) client.revenue = patch.revenue;
        if (patch.familyId !== undefined) client.familyId = patch.familyId;
        if (patch.familyRole !== undefined) client.familyRole = patch.familyRole;
        if (patch.heldAway !== undefined) client.heldAway = patch.heldAway;
        if (patch.heldAwayNote !== undefined) client.heldAwayNote = patch.heldAwayNote?.trim() || null;
        if (tierChanged) recomputeClient(id);
      }

      rebuild(todayISO());
      return snapshot();
    },

    async updateContactEvent(eventId: string, patch: UpdateContactInput) {
      const s = ensureLoaded();
      const event = s.snapshot.contactEvents.find((e) => e.id === eventId);
      if (event) {
        if (patch.advisor !== undefined) event.advisor = patch.advisor;
        if (patch.type !== undefined) event.type = patch.type;
        if (patch.eventDate !== undefined) event.eventDate = patch.eventDate;
        if (patch.durationMinutes !== undefined) event.durationMinutes = patch.durationMinutes;
        if (patch.notes !== undefined) event.notes = patch.notes?.trim() || null;
        recomputeClient(event.clientId);
        rebuild(todayISO());
      }
      return snapshot();
    },

    async deleteContactEvent(eventId: string) {
      const s = ensureLoaded();
      const event = s.snapshot.contactEvents.find((e) => e.id === eventId);
      if (event) {
        const clientId = event.clientId;
        s.snapshot.contactEvents = s.snapshot.contactEvents.filter((e) => e.id !== eventId);
        recomputeClient(clientId);
        rebuild(todayISO());
      }
      return snapshot();
    },

    async snoozeTouch(clientId: string, type: TouchType, untilDate: string | null) {
      const s = ensureLoaded();
      const due = s.snapshot.dueDates.find((d) => d.clientId === clientId && d.type === type);
      if (due) {
        due.snoozedUntil = untilDate;
        rebuild(todayISO());
      }
      return snapshot();
    },

    async planOutreach(items: Array<{ clientId: string; dueDate: string }>) {
      const s = ensureLoaded();
      const now = new Date().toISOString();
      for (const item of items) {
        // Don't clobber a client who already has a call due date.
        if (s.snapshot.dueDates.some((d) => d.clientId === item.clientId && d.type === "call")) {
          continue;
        }
        s.snapshot.dueDates.push({
          id: uid(),
          clientId: item.clientId,
          type: "call",
          dueDate: item.dueDate,
          computedFromEventId: null, // marks a first-outreach placeholder
          snoozedUntil: null,
          updatedAt: now,
        });
      }
      rebuild(todayISO());
      return snapshot();
    },

    async updateClient(clientId: string, patch: UpdateClientInput) {
      const s = ensureLoaded();
      const client = s.snapshot.clients.find((c) => c.id === clientId);
      if (client) {
        const tierChanged = patch.tier !== undefined && patch.tier !== client.tier;
        if (patch.householdName !== undefined) client.householdName = patch.householdName.trim();
        if (patch.assignedAdvisor !== undefined) client.assignedAdvisor = patch.assignedAdvisor;
        if (patch.tier !== undefined) client.tier = patch.tier;
        if (patch.active !== undefined) client.active = patch.active;
        if (patch.phone !== undefined) client.phone = patch.phone?.trim() || null;
        if (patch.revenue !== undefined) client.revenue = patch.revenue;
        if (patch.familyId !== undefined) client.familyId = patch.familyId;
        if (patch.familyRole !== undefined) client.familyRole = patch.familyRole;
        if (patch.heldAway !== undefined) client.heldAway = patch.heldAway;
        if (patch.heldAwayNote !== undefined) client.heldAwayNote = patch.heldAwayNote?.trim() || null;
        if (patch.tags !== undefined) client.tags = patch.tags;
        if (patch.nextMeetingDate !== undefined) client.nextMeetingDate = patch.nextMeetingDate;
        if (patch.nextMeetingNote !== undefined) {
          client.nextMeetingNote = patch.nextMeetingNote?.trim() || null;
        }
        if (tierChanged) recomputeClient(clientId);
        rebuild(todayISO());
      }
      return snapshot();
    },

    async deleteClient(clientId: string) {
      const s = ensureLoaded();
      // Erase the household and everything that hangs off it.
      s.snapshot.clients = s.snapshot.clients.filter((c) => c.id !== clientId);
      s.snapshot.contactEvents = s.snapshot.contactEvents.filter((e) => e.clientId !== clientId);
      s.snapshot.dueDates = s.snapshot.dueDates.filter((d) => d.clientId !== clientId);
      s.snapshot.tasks = s.snapshot.tasks.filter((t) => t.clientId !== clientId);
      cleanupFamilies();
      persist();
      return snapshot();
    },

    // --- Family linking ---
    async linkFamily(
      clientIds: string[],
      familyId: string | null,
      name: string | null,
      roles: Record<string, FamilyRole> = {},
    ) {
      const s = ensureLoaded();
      let fid = familyId;
      if (!fid) {
        fid = uid();
        s.snapshot.families.push({
          id: fid,
          name: name?.trim() || defaultFamilyName(clientIds),
          createdAt: new Date().toISOString(),
        });
      }
      for (const id of clientIds) {
        const c = s.snapshot.clients.find((x) => x.id === id);
        if (!c) continue;
        c.familyId = fid;
        if (roles[id]) c.familyRole = roles[id];
        else if (!c.familyRole) c.familyRole = "other";
      }
      cleanupFamilies();
      persist();
      return snapshot();
    },

    async unlinkFromFamily(clientId: string) {
      const s = ensureLoaded();
      const c = s.snapshot.clients.find((x) => x.id === clientId);
      if (c) {
        c.familyId = null;
        c.familyRole = null;
      }
      cleanupFamilies();
      persist();
      return snapshot();
    },

    async renameFamily(familyId: string, name: string) {
      const s = ensureLoaded();
      const f = s.snapshot.families.find((x) => x.id === familyId);
      if (f) f.name = name.trim() || f.name;
      persist();
      return snapshot();
    },

    async autoLinkBySurname() {
      const s = ensureLoaded();
      const now = new Date().toISOString();
      // Book-aware: only households sharing a surname AND an advisor pair up,
      // so different advisors' same-surname clients never merge.
      for (const group of planSurnameLinks(s.snapshot.clients)) {
        const fid = uid();
        s.snapshot.families.push({ id: fid, name: `${group.surname} Family`, createdAt: now });
        group.clients.forEach((c, i) => {
          c.familyId = fid;
          c.familyRole = i === 0 ? "head" : "other";
        });
      }
      persist();
      return snapshot();
    },

    async updateServiceModel(model: ServiceModel) {
      const s = ensureLoaded();
      s.snapshot.serviceModels = s.snapshot.serviceModels.map((m) =>
        m.tier === model.tier ? { ...model } : m,
      );
      // The rules changed — the whole book reflows.
      for (const client of s.snapshot.clients) recomputeClient(client.id);
      rebuild(todayISO());
      return snapshot();
    },

    async bulkSetTiers(assignments: Array<{ clientId: string; tier: Tier }>) {
      const s = ensureLoaded();
      for (const { clientId, tier } of assignments) {
        const c = s.snapshot.clients.find((x) => x.id === clientId);
        if (c && c.tier !== tier) {
          c.tier = tier;
          recomputeClient(clientId);
        }
      }
      rebuild(todayISO());
      return snapshot();
    },

    // --- Prospects (no engine interaction whatsoever) ---
    async addProspect(input: AddProspectInput) {
      const s = ensureLoaded();
      const now = new Date().toISOString();
      const prospect: Prospect = {
        id: uid(),
        name: input.name.trim(),
        assignedAdvisor: input.assignedAdvisor,
        phone: input.phone?.trim() || null,
        status: input.status,
        notes: input.notes?.trim() || null,
        nextFollowUp: input.nextFollowUp || null,
        createdAt: now,
        updatedAt: now,
      };
      s.snapshot.prospects.push(prospect);
      persist();
      return snapshot();
    },

    async updateProspect(prospectId: string, patch: UpdateProspectInput) {
      const s = ensureLoaded();
      const p = s.snapshot.prospects.find((x) => x.id === prospectId);
      if (p) {
        if (patch.name !== undefined) p.name = patch.name.trim();
        if (patch.assignedAdvisor !== undefined) p.assignedAdvisor = patch.assignedAdvisor;
        if (patch.phone !== undefined) p.phone = patch.phone?.trim() || null;
        if (patch.status !== undefined) p.status = patch.status;
        if (patch.notes !== undefined) p.notes = patch.notes?.trim() || null;
        if (patch.nextFollowUp !== undefined) p.nextFollowUp = patch.nextFollowUp || null;
        p.updatedAt = new Date().toISOString();
        persist();
      }
      return snapshot();
    },

    async deleteProspect(prospectId: string) {
      const s = ensureLoaded();
      s.snapshot.prospects = s.snapshot.prospects.filter((x) => x.id !== prospectId);
      s.snapshot.prospectEvents = s.snapshot.prospectEvents.filter((e) => e.prospectId !== prospectId);
      persist();
      return snapshot();
    },

    async logProspectContact(input: LogProspectInput) {
      const s = ensureLoaded();
      s.snapshot.prospectEvents.push({
        id: uid(),
        prospectId: input.prospectId,
        advisor: input.advisor,
        type: input.type,
        eventDate: input.eventDate,
        notes: input.notes?.trim() || null,
        createdAt: new Date().toISOString(),
      });
      const p = s.snapshot.prospects.find((x) => x.id === input.prospectId);
      if (p) {
        if (input.nextFollowUp !== undefined) p.nextFollowUp = input.nextFollowUp || null;
        // First touch nudges a brand-new prospect into "working".
        if (p.status === "new" && (input.type === "call" || input.type === "voicemail" || input.type === "meeting")) {
          p.status = "working";
        }
        p.updatedAt = new Date().toISOString();
      }
      persist();
      return snapshot();
    },

    async deleteProspectEvent(eventId: string) {
      const s = ensureLoaded();
      s.snapshot.prospectEvents = s.snapshot.prospectEvents.filter((e) => e.id !== eventId);
      persist();
      return snapshot();
    },

    async rebuildQueue() {
      rebuild(todayISO());
      return snapshot();
    },

    async adminResetPassword() {
      throw new Error("Password resets are available once you're running on Supabase.");
    },

    async reset() {
      store.removeItem(STORAGE_KEY);
      state = seed();
      persist();
      return snapshot();
    },
  };
}

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}
