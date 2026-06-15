import type {
  AddClientInput,
  DataSnapshot,
  LogContactInput,
  ServiceModel,
  TouchType,
  UpdateClientInput,
  UpdateContactInput,
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
  /** Phase 2: bulk import from the CSV wizard. */
  importClients(inputs: AddClientInput[]): Promise<DataSnapshot>;
  /** Correct a mis-logged touch; recomputes due dates. */
  updateContactEvent(eventId: string, patch: UpdateContactInput): Promise<DataSnapshot>;
  /** Remove a touch logged in error; recomputes due dates. */
  deleteContactEvent(eventId: string): Promise<DataSnapshot>;
  /** Defer a touch off the queue until `untilDate` (or clear with null). */
  snoozeTouch(clientId: string, type: TouchType, untilDate: string | null): Promise<DataSnapshot>;
  /** Schedule first-touch calls for never-contacted clients (Phase: outreach). */
  planOutreach(items: Array<{ clientId: string; dueDate: string }>): Promise<DataSnapshot>;
  updateClient(clientId: string, patch: UpdateClientInput): Promise<DataSnapshot>;
  updateServiceModel(model: ServiceModel): Promise<DataSnapshot>;
  /** Re-run the nightly rebuild on demand (the "6am job, now" button). */
  rebuildQueue(): Promise<DataSnapshot>;
  /** Demo only: wipe and reseed. */
  reset?(): Promise<DataSnapshot>;
}
