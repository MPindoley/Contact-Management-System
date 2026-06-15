// Demo backend: the full service engine running in the browser, persisted to
// localStorage. Lets the firm evaluate the entire Phase 1 workflow before a
// Supabase project exists. Swapped out automatically once
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are configured.

import type {
  AddClientInput,
  Client,
  ContactEvent,
  DataSnapshot,
  LogContactInput,
  ServiceModel,
  TouchType,
  UpdateClientInput,
  UpdateContactInput,
} from "../../types";
import type { DataAdapter } from "./adapter";
import { todayISO } from "../dates";
import {
  computeClientDueDates,
  rebuildAllTasks,
  settleTasks,
  uid,
} from "../../engine/serviceEngine";
import { buildDemoSnapshot } from "./demoSeed";

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
    s.snapshot.dueDates = [
      ...s.snapshot.dueDates.filter((d) => d.clientId !== clientId),
      ...fresh,
    ];
  }

  function snapshot(): DataSnapshot {
    return clone(ensureLoaded().snapshot);
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

      if (event.type !== "admin") {
        // A completed touch settles the matching open task and resets the clock.
        s.snapshot.tasks = settleTasks(s.snapshot.tasks, event.clientId, event.type);
        recomputeClient(event.clientId);
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
        redtailId: input.redtailId?.trim() || null,
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

    async importClients(inputs: AddClientInput[]) {
      const s = ensureLoaded();
      const now = new Date().toISOString();
      for (const input of inputs) {
        const client: Client = {
          id: uid(),
          householdName: input.householdName.trim(),
          assignedAdvisor: input.assignedAdvisor,
          tier: input.tier,
          active: true,
          redtailId: input.redtailId?.trim() || null,
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

    async updateClient(clientId: string, patch: UpdateClientInput) {
      const s = ensureLoaded();
      const client = s.snapshot.clients.find((c) => c.id === clientId);
      if (client) {
        const tierChanged = patch.tier !== undefined && patch.tier !== client.tier;
        if (patch.householdName !== undefined) client.householdName = patch.householdName.trim();
        if (patch.assignedAdvisor !== undefined) client.assignedAdvisor = patch.assignedAdvisor;
        if (patch.tier !== undefined) client.tier = patch.tier;
        if (patch.active !== undefined) client.active = patch.active;
        if (tierChanged) recomputeClient(clientId);
        rebuild(todayISO());
      }
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

    async rebuildQueue() {
      rebuild(todayISO());
      return snapshot();
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
