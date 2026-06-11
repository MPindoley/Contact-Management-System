import type {
  AddClientInput,
  DataSnapshot,
  LogContactInput,
  ServiceModel,
  UpdateClientInput,
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
  updateClient(clientId: string, patch: UpdateClientInput): Promise<DataSnapshot>;
  updateServiceModel(model: ServiceModel): Promise<DataSnapshot>;
  /** Re-run the nightly rebuild on demand (the "6am job, now" button). */
  rebuildQueue(): Promise<DataSnapshot>;
  /** Demo only: wipe and reseed. */
  reset?(): Promise<DataSnapshot>;
}
