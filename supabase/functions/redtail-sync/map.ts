// Redtail → Relationship Hub sync planning. Pure logic, no Deno APIs.
//
// Redtail's API responses vary by version and endpoint, so parsing is
// deliberately tolerant: it hunts for the contact id, a household-ish name,
// and a status across the field spellings Redtail has used. The dry-run
// output shows exactly what was parsed before anything is written.
//
// Self-contained on purpose: `supabase functions deploy` bundles only this
// directory, so nothing here may import from src/.

export interface ParsedContact {
  redtailId: string;
  householdName: string;
  status: string | null;
}

export interface ExistingClient {
  id: string;
  household_name: string;
  redtail_id: string | null;
  active: boolean;
}

export interface SyncPlan {
  /** In Redtail, not in the book → insert with the default tier/advisor. */
  creates: Array<{ redtail_id: string; household_name: string }>;
  /** Linked client whose name changed in Redtail. */
  renames: Array<{ id: string; from: string; to: string; redtail_id: string }>;
  /** Existing unlinked client matched by name → stamp the Redtail id. */
  relinks: Array<{ id: string; household_name: string; redtail_id: string }>;
  /** Linked + active locally but gone from the Redtail feed. */
  deactivations: Array<{ id: string; household_name: string; redtail_id: string }>;
  unchanged: number;
  skippedNoName: number;
  warnings: string[];
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

/** Accepts a page payload in any of the shapes Redtail endpoints return. */
export function parseContacts(payload: unknown): { contacts: ParsedContact[]; skippedNoName: number } {
  let records: unknown[] = [];
  if (Array.isArray(payload)) {
    records = payload;
  } else if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["contacts", "Contacts", "data", "Data", "records", "Records"]) {
      if (Array.isArray(obj[key])) {
        records = obj[key] as unknown[];
        break;
      }
    }
  }

  const contacts: ParsedContact[] = [];
  let skippedNoName = 0;

  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;

    const id = firstString(r, ["ContactID", "ContactId", "contact_id", "Id", "ID", "id"]);
    if (!id) continue;

    const family = firstString(r, [
      "Familyname", "FamilyName", "family_name",
      "Householdname", "HouseholdName", "household_name",
    ]);
    const last = firstString(r, ["Lastname", "LastName", "last_name"]);
    const first = firstString(r, ["Firstname", "FirstName", "first_name"]);
    const full = firstString(r, ["Fullname", "FullName", "full_name", "Name", "name"]);

    const householdName = family ?? (last ? (first ? `${last}, ${first}` : last) : full);
    if (!householdName) {
      skippedNoName++;
      continue;
    }

    contacts.push({
      redtailId: id,
      householdName,
      status: firstString(r, ["ContactStatus", "Status", "status", "StatusID", "status_id"]),
    });
  }

  // First occurrence wins when Redtail repeats an id across pages.
  const seen = new Set<string>();
  const deduped = contacts.filter((c) => {
    if (seen.has(c.redtailId)) return false;
    seen.add(c.redtailId);
    return true;
  });

  return { contacts: deduped, skippedNoName };
}

export interface PlanOptions {
  /** When set, only contacts whose status contains this (case-insensitive). */
  statusFilter?: string | null;
}

export function buildSyncPlan(
  parsed: ParsedContact[],
  existing: ExistingClient[],
  options: PlanOptions = {},
): SyncPlan {
  const warnings: string[] = [];
  const filter = options.statusFilter?.trim().toLowerCase() || null;

  const feed = filter
    ? parsed.filter((c) => c.status !== null && c.status.toLowerCase().includes(filter))
    : parsed;
  if (filter && feed.length === 0 && parsed.length > 0) {
    warnings.push(
      `Status filter "${options.statusFilter}" matched none of ${parsed.length} contacts — check the filter value.`,
    );
  }

  const byRedtailId = new Map(existing.flatMap((c) => (c.redtail_id ? [[c.redtail_id, c] as const] : [])));
  const unlinkedByName = new Map(
    existing.filter((c) => !c.redtail_id).map((c) => [c.household_name.trim().toLowerCase(), c]),
  );

  const plan: SyncPlan = {
    creates: [],
    renames: [],
    relinks: [],
    deactivations: [],
    unchanged: 0,
    skippedNoName: 0,
    warnings,
  };

  const seenIds = new Set<string>();
  for (const contact of feed) {
    seenIds.add(contact.redtailId);
    const linked = byRedtailId.get(contact.redtailId);
    if (linked) {
      if (linked.household_name.trim() !== contact.householdName) {
        plan.renames.push({
          id: linked.id,
          from: linked.household_name,
          to: contact.householdName,
          redtail_id: contact.redtailId,
        });
      } else {
        plan.unchanged++;
      }
      continue;
    }

    const nameMatch = unlinkedByName.get(contact.householdName.trim().toLowerCase());
    if (nameMatch) {
      plan.relinks.push({
        id: nameMatch.id,
        household_name: nameMatch.household_name,
        redtail_id: contact.redtailId,
      });
      unlinkedByName.delete(contact.householdName.trim().toLowerCase());
      continue;
    }

    plan.creates.push({ redtail_id: contact.redtailId, household_name: contact.householdName });
  }

  // Linked + active locally, absent from the feed → deactivate. With a
  // sanity guard: a half-failed fetch must never mass-deactivate the book.
  const linkedActive = existing.filter((c) => c.redtail_id && c.active);
  const missing = linkedActive.filter((c) => !seenIds.has(c.redtail_id!));
  if (linkedActive.length >= 4 && missing.length > linkedActive.length / 2) {
    warnings.push(
      `${missing.length} of ${linkedActive.length} linked households are missing from the feed — ` +
        "that looks like a partial fetch, so no deactivations were planned.",
    );
  } else {
    for (const c of missing) {
      plan.deactivations.push({ id: c.id, household_name: c.household_name, redtail_id: c.redtail_id! });
    }
  }

  return plan;
}
