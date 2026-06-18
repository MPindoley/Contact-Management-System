import type {
  AddClientInput,
  AddProspectInput,
  DataSnapshot,
  FamilyRole,
  LogContactInput,
  LogProspectInput,
  ServiceModel,
  Tier,
  TouchType,
  UpdateClientInput,
  UpdateContactInput,
  UpdateProspectInput,
} from "../../types";

/**
 * Everything the UI needs from a backend. Two implementations:
 *  - demoAdapter: in-browser dataset persisted to localStorage, runs the
 *    service engine locally. Zero setup.
 *  - supabaseAdapter: real backend; the engine runs as database triggers.
 *
 * Mutations resolve with a fresh snapshot — at Phase 1 scale (≤ a few
 * hundred households) reloading state wholesale is simple and bulletproof.
 */
export interface DataAdapter {
  readonly mode: "demo" | "supabase";
  load(): Promise<DataSnapshot>;
  logContact(input: LogContactInput): Promise<DataSnapshot>;
  addClient(input: AddClientInput): Promise<DataSnapshot>;
  /**
   * Phase 2: bulk import/reconcile from the CSV wizard. Creates new
   * households and applies field updates (tier/advisor/phone) to existing
   * ones — never touching their logged contact history.
   */
  importClients(
    creates: AddClientInput[],
    updates: Array<{ id: string; patch: UpdateClientInput }>,
  ): Promise<DataSnapshot>;
  /** Correct a mis-logged touch; recomputes due dates. */
  updateContactEvent(eventId: string, patch: UpdateContactInput): Promise<DataSnapshot>;
  /** Remove a touch logged in error; recomputes due dates. */
  deleteContactEvent(eventId: string): Promise<DataSnapshot>;
  /** Defer a touch off the queue until `untilDate` (or clear with null). */
  snoozeTouch(clientId: string, type: TouchType, untilDate: string | null): Promise<DataSnapshot>;
  /** Schedule first-touch calls for never-contacted clients (Phase: outreach). */
  planOutreach(items: Array<{ clientId: string; dueDate: string }>): Promise<DataSnapshot>;
  updateClient(clientId: string, patch: UpdateClientInput): Promise<DataSnapshot>;
  /** Permanently delete a household and all its contact history. */
  deleteClient(clientId: string): Promise<DataSnapshot>;
  updateServiceModel(model: ServiceModel): Promise<DataSnapshot>;
  /** Apply tier assignments in bulk (used by re-tier from criteria). */
  bulkSetTiers(assignments: Array<{ clientId: string; tier: Tier }>): Promise<DataSnapshot>;

  // --- Family linking ---
  /** Link households into a family (new family if familyId is null). */
  linkFamily(
    clientIds: string[],
    familyId: string | null,
    name: string | null,
    roles?: Record<string, FamilyRole>,
  ): Promise<DataSnapshot>;
  unlinkFromFamily(clientId: string): Promise<DataSnapshot>;
  renameFamily(familyId: string, name: string): Promise<DataSnapshot>;
  /**
   * Group un-familied households that share a surname *and* a book into
   * families. Same surname across different advisors' books never merges.
   */
  autoLinkBySurname(): Promise<DataSnapshot>;

  // --- Prospects (separate island; never touches client data) ---
  addProspect(input: AddProspectInput): Promise<DataSnapshot>;
  updateProspect(prospectId: string, patch: UpdateProspectInput): Promise<DataSnapshot>;
  deleteProspect(prospectId: string): Promise<DataSnapshot>;
  logProspectContact(input: LogProspectInput): Promise<DataSnapshot>;
  deleteProspectEvent(eventId: string): Promise<DataSnapshot>;

  /** Re-run the nightly rebuild on demand (the "6am job, now" button). */
  rebuildQueue(): Promise<DataSnapshot>;
  /** Demo only: wipe and reseed. */
  reset?(): Promise<DataSnapshot>;
}
