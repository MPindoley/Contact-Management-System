// CSV import engine: parse → map columns → resolve tiers/advisors/dates.
// Pure functions, unit-tested; the Import screen is a thin wizard over these.

import type { AddClientInput, AdvisorAssignment, Tier, UpdateClientInput } from "../types";
import { ADVISOR_LABELS } from "../types";

// ---------------------------------------------------------------------------
// CSV parsing (RFC 4180: quoted fields, embedded commas/newlines, CRLF, BOM)
// ---------------------------------------------------------------------------

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): ParsedCsv {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const [headers, ...body] = nonEmpty;
  return { headers: headers.map((h) => h.trim()), rows: body };
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

export type ImportField =
  | "householdName"
  | "advisor"
  | "tier"
  | "revenue"
  | "phone"
  | "heldAway"
  | "lastMeetingDate"
  | "lastCallDate"
  | "redtailId";

export type ColumnMapping = Partial<Record<ImportField, number>>;

const HEADER_HINTS: Record<ImportField, RegExp> = {
  householdName: /house ?hold|family ?name|client ?name|^name$|full ?name|account ?name/i,
  advisor: /advisor|rep\b|servicer|owner|assigned/i,
  tier: /tier|segment|class(?!ic)|category|level/i,
  revenue: /revenue|aum|assets|value|fee/i,
  phone: /phone|mobile|cell|telephone|^tel$/i,
  heldAway: /held.?away|outside|elsewhere|capture|money.?due|opportunit/i,
  lastMeetingDate: /last.*(meeting|review|appt|appointment)|meeting.*date/i,
  lastCallDate: /last.*(call|contact|touch)|call.*date/i,
  redtailId: /redtail|crm.?id|contact.?id|^id$/i,
};

/** Reads loose truthy values from a CSV cell: yes / y / true / 1 / x / ✓. */
export function parseBoolish(raw: string): boolean {
  return /^(y|yes|true|t|1|x|✓|✔)$/i.test(raw.trim());
}

/** Best-effort auto-mapping from header names; user can override in the UI. */
export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<number>();
  for (const field of Object.keys(HEADER_HINTS) as ImportField[]) {
    const idx = headers.findIndex((h, i) => !taken.has(i) && HEADER_HINTS[field].test(h));
    if (idx >= 0) {
      mapping[field] = idx;
      taken.add(idx);
    }
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Value normalization
// ---------------------------------------------------------------------------

/** "$1,250,000.50" → 1250000.5 (null when unparseable). */
export function parseRevenue(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** "S" / "A" / "tier b" / "C-class" → Tier (null when unrecognized). */
export function parseTier(raw: string): Tier | null {
  const m = raw.trim().match(/\b([sabc])\b/i) ?? raw.trim().match(/^([sabc])/i);
  if (!m) return null;
  return m[1].toUpperCase() as Tier;
}

/**
 * Dates as Redtail and spreadsheets emit them: 2026-06-12, 6/12/2026,
 * 06/12/26. Returns ISO YYYY-MM-DD, or null when blank/unparseable.
 */
export function parseDateValue(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) return toValidISO(Number(m[1]), Number(m[2]), Number(m[3]));

  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return toValidISO(year, Number(m[1]), Number(m[2]));
  }
  return null;
}

function toValidISO(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  const mm = String(mo).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Building import rows
// ---------------------------------------------------------------------------

export interface TierThresholds {
  /** revenue ≥ a → Tier A; revenue ≥ b → Tier B; below → Tier C. */
  a: number;
  b: number;
}

/** The existing-book fields the importer needs to detect and reconcile. */
export interface ExistingClientLite {
  id: string;
  householdName: string;
  tier: Tier;
  assignedAdvisor: AdvisorAssignment;
  phone: string | null;
  redtailId: string | null;
  heldAway: boolean;
}

export interface ImportOptions {
  mapping: ColumnMapping;
  /** Used when no advisor column is mapped or a value is unmapped. */
  defaultAdvisor: AdvisorAssignment;
  /** Used when neither a tier nor a revenue column decides it. */
  defaultTier: Tier;
  /** Maps distinct advisor-column values (lowercased) → assignment. */
  advisorValueMap: Record<string, AdvisorAssignment>;
  /** Auto-assign tier from the revenue column when mapped. */
  thresholds: TierThresholds | null;
  /** The current book — used to match rows and reconcile changed fields. */
  existingClients: ExistingClientLite[];
  /** Apply field updates to matched households (false = skip them). */
  applyUpdates: boolean;
}

export type ImportRowStatus = "new" | "update" | "unchanged" | "duplicate";

export interface ImportPreviewRow {
  line: number;
  householdName: string;
  status: ImportRowStatus;
  /** For a new household. */
  input?: AddClientInput;
  /** For a matched household: which existing row and what to change. */
  existingId?: string;
  patch?: UpdateClientInput;
  /** Human-readable change list for an update row, e.g. ["Tier B → A"]. */
  changes: string[];
  /** Soft problems worth knowing about (bad date, unrecognized tier…). */
  warnings: string[];
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  newCount: number;
  updateCount: number;
  unchangedCount: number;
  duplicateCount: number;
  skippedNoName: number;
  /** Tier distribution of the NEW households (for the cutoff preview). */
  tierCounts: Record<Tier, number>;
}

export function tierForRevenue(revenue: number, t: TierThresholds): Tier {
  if (revenue >= t.a) return "A";
  if (revenue >= t.b) return "B";
  return "C";
}

export function buildImportPreview(csv: ParsedCsv, options: ImportOptions): ImportPreview {
  const { mapping, thresholds } = options;
  const rows: ImportPreviewRow[] = [];
  let skippedNoName = 0;
  const tierCounts: Record<Tier, number> = { S: 0, A: 0, B: 0, C: 0 };
  const seenNames = new Set<string>();
  const seenRedtail = new Set<string>();

  // Match an incoming row to the current book by Redtail id, then by name.
  const byName = new Map<string, ExistingClientLite>();
  const byRedtail = new Map<string, ExistingClientLite>();
  for (const c of options.existingClients) {
    byName.set(c.householdName.trim().toLowerCase(), c);
    if (c.redtailId) byRedtail.set(c.redtailId, c);
  }

  const cell = (row: string[], field: ImportField): string => {
    const idx = mapping[field];
    return idx === undefined ? "" : (row[idx] ?? "").trim();
  };

  csv.rows.forEach((raw, i) => {
    const line = i + 2; // 1-based + header row
    const name = cell(raw, "householdName");
    if (!name) {
      skippedNoName++;
      return;
    }
    const warnings: string[] = [];

    // Advisor — "explicit" only when the file actually specifies a known one.
    let advisor = options.defaultAdvisor;
    let advisorExplicit = false;
    const advisorRaw = cell(raw, "advisor");
    if (advisorRaw) {
      const mapped = options.advisorValueMap[advisorRaw.toLowerCase()];
      if (mapped) {
        advisor = mapped;
        advisorExplicit = true;
      } else {
        warnings.push(`advisor "${advisorRaw}" not mapped — using ${options.defaultAdvisor}`);
      }
    }

    // Tier — explicit when a tier column or a revenue cutoff decides it.
    let tier: Tier | null = null;
    let tierExplicit = false;
    const tierRaw = cell(raw, "tier");
    if (tierRaw) {
      tier = parseTier(tierRaw);
      if (tier) tierExplicit = true;
      else warnings.push(`tier "${tierRaw}" not recognized`);
    }
    if (!tier && thresholds && mapping.revenue !== undefined) {
      const revenue = parseRevenue(cell(raw, "revenue"));
      if (revenue !== null) {
        tier = tierForRevenue(revenue, thresholds);
        tierExplicit = true;
      } else if (cell(raw, "revenue")) {
        warnings.push(`revenue "${cell(raw, "revenue")}" not a number`);
      }
    }
    tier ??= options.defaultTier;

    // Dates (only ever used when CREATING — never re-seeded onto existing).
    const meetingRaw = cell(raw, "lastMeetingDate");
    const callRaw = cell(raw, "lastCallDate");
    const lastMeetingDate = parseDateValue(meetingRaw);
    const lastCallDate = parseDateValue(callRaw);
    if (meetingRaw && !lastMeetingDate) warnings.push(`couldn't read meeting date "${meetingRaw}"`);
    if (callRaw && !lastCallDate) warnings.push(`couldn't read call date "${callRaw}"`);

    const redtailId = cell(raw, "redtailId") || null;
    const phoneRaw = cell(raw, "phone");
    const phone = phoneRaw || null;
    // Held-away money flag — only "explicit" when the column is mapped.
    const heldAwayProvided = mapping.heldAway !== undefined;
    const heldAway = heldAwayProvided && parseBoolish(cell(raw, "heldAway"));
    const nameKey = name.toLowerCase();

    // Second+ time we've seen this household within the file → skip it.
    if (seenNames.has(nameKey) || (redtailId && seenRedtail.has(redtailId))) {
      rows.push({ line, householdName: name, status: "duplicate", changes: [], warnings });
      return;
    }
    seenNames.add(nameKey);
    if (redtailId) seenRedtail.add(redtailId);

    const existing = (redtailId && byRedtail.get(redtailId)) || byName.get(nameKey) || null;

    if (existing) {
      // Reconcile: only fields the CSV explicitly specifies, only when changed,
      // and NEVER the contact history (dates are ignored for existing rows).
      const patch: UpdateClientInput = {};
      const changes: string[] = [];
      if (tierExplicit && tier !== existing.tier) {
        patch.tier = tier;
        changes.push(`Tier ${existing.tier} → ${tier}`);
      }
      if (advisorExplicit && advisor !== existing.assignedAdvisor) {
        patch.assignedAdvisor = advisor;
        changes.push(`${ADVISOR_LABELS[existing.assignedAdvisor]} → ${ADVISOR_LABELS[advisor]}`);
      }
      if (phone !== null && phone !== existing.phone) {
        patch.phone = phone;
        changes.push(existing.phone ? "Phone updated" : "Phone added");
      }
      if (heldAwayProvided && heldAway && !existing.heldAway) {
        patch.heldAway = true;
        changes.push("Flagged: money to capture");
      }

      const hasChanges = changes.length > 0 && options.applyUpdates;
      rows.push({
        line,
        householdName: name,
        status: hasChanges ? "update" : "unchanged",
        existingId: existing.id,
        patch: hasChanges ? patch : undefined,
        changes,
        warnings,
      });
      return;
    }

    // Brand-new household.
    tierCounts[tier]++;
    rows.push({
      line,
      householdName: name,
      status: "new",
      changes: [],
      warnings,
      input: { householdName: name, assignedAdvisor: advisor, tier, phone, redtailId, heldAway, heldAwayNote: null, lastMeetingDate, lastCallDate },
    });
  });

  return {
    rows,
    newCount: rows.filter((r) => r.status === "new").length,
    updateCount: rows.filter((r) => r.status === "update").length,
    unchangedCount: rows.filter((r) => r.status === "unchanged").length,
    duplicateCount: rows.filter((r) => r.status === "duplicate").length,
    skippedNoName,
    tierCounts,
  };
}

/** Distinct advisor-column values, for the value-mapping UI. */
export function distinctAdvisorValues(csv: ParsedCsv, mapping: ColumnMapping): string[] {
  const idx = mapping.advisor;
  if (idx === undefined) return [];
  const seen = new Map<string, string>();
  for (const row of csv.rows) {
    const v = (row[idx] ?? "").trim();
    if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  }
  return [...seen.values()].slice(0, 12);
}

export const CSV_TEMPLATE = [
  "Household Name,Advisor,Revenue,Phone,Money to Capture,Last Meeting,Last Call,Redtail ID",
  '"Whitfield, Daniel & Mara",Matt,250000,(419) 555-0182,yes,3/14/2026,5/28/2026,48200',
  '"Castellanos Family",Beau,90000,(419) 555-0143,,1/9/2026,4/2/2026,48237',
  '"Abernathy, Gordon",Joint,24000,(419) 555-0117,,11/20/2025,2/13/2026,48274',
].join("\n");
