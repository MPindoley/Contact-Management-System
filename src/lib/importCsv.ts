// CSV import engine: parse → map columns → resolve tiers/advisors/dates.
// Pure functions, unit-tested; the Import screen is a thin wizard over these.

import type { AddClientInput, AdvisorAssignment, Tier } from "../types";

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
  | "lastMeetingDate"
  | "lastCallDate"
  | "redtailId";

export type ColumnMapping = Partial<Record<ImportField, number>>;

const HEADER_HINTS: Record<ImportField, RegExp> = {
  householdName: /house ?hold|family ?name|client ?name|^name$|full ?name|account ?name/i,
  advisor: /advisor|rep\b|servicer|owner|assigned/i,
  tier: /tier|segment|class(?!ic)|category|level/i,
  revenue: /revenue|aum|assets|value|fee/i,
  lastMeetingDate: /last.*(meeting|review|appt|appointment)|meeting.*date/i,
  lastCallDate: /last.*(call|contact|touch)|call.*date/i,
  redtailId: /redtail|crm.?id|contact.?id|^id$/i,
};

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

/** "A" / "tier b" / "C-class" → Tier (null when unrecognized). */
export function parseTier(raw: string): Tier | null {
  const m = raw.trim().match(/\b([abc])\b/i) ?? raw.trim().match(/^([abc])/i);
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
  /** Lowercased household names + redtail ids that already exist. */
  existingNames: Set<string>;
  existingRedtailIds: Set<string>;
}

export interface ImportPreviewRow {
  input: AddClientInput;
  line: number;
  status: "ready" | "duplicate";
  /** Soft problems worth knowing about (bad date, unrecognized tier…). */
  warnings: string[];
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  readyCount: number;
  duplicateCount: number;
  skippedNoName: number;
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
  const tierCounts: Record<Tier, number> = { A: 0, B: 0, C: 0 };
  const seenNames = new Set<string>();
  const seenRedtail = new Set<string>();

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

    // Advisor
    let advisor = options.defaultAdvisor;
    const advisorRaw = cell(raw, "advisor");
    if (advisorRaw) {
      const mapped = options.advisorValueMap[advisorRaw.toLowerCase()];
      if (mapped) advisor = mapped;
      else warnings.push(`advisor "${advisorRaw}" not mapped — using ${options.defaultAdvisor}`);
    }

    // Tier: explicit column wins, then revenue thresholds, then default.
    let tier: Tier | null = null;
    const tierRaw = cell(raw, "tier");
    if (tierRaw) {
      tier = parseTier(tierRaw);
      if (!tier) warnings.push(`tier "${tierRaw}" not recognized`);
    }
    if (!tier && thresholds && mapping.revenue !== undefined) {
      const revenue = parseRevenue(cell(raw, "revenue"));
      if (revenue !== null) tier = tierForRevenue(revenue, thresholds);
      else if (cell(raw, "revenue")) warnings.push(`revenue "${cell(raw, "revenue")}" not a number`);
    }
    tier ??= options.defaultTier;

    // Dates
    const meetingRaw = cell(raw, "lastMeetingDate");
    const callRaw = cell(raw, "lastCallDate");
    const lastMeetingDate = parseDateValue(meetingRaw);
    const lastCallDate = parseDateValue(callRaw);
    if (meetingRaw && !lastMeetingDate) warnings.push(`couldn't read meeting date "${meetingRaw}"`);
    if (callRaw && !lastCallDate) warnings.push(`couldn't read call date "${callRaw}"`);

    const redtailId = cell(raw, "redtailId") || null;

    // Duplicates: against the existing book and within the file itself.
    const nameKey = name.toLowerCase();
    const dupe =
      options.existingNames.has(nameKey) ||
      seenNames.has(nameKey) ||
      (redtailId !== null &&
        (options.existingRedtailIds.has(redtailId) || seenRedtail.has(redtailId)));
    seenNames.add(nameKey);
    if (redtailId) seenRedtail.add(redtailId);

    if (!dupe) tierCounts[tier]++;

    rows.push({
      line,
      status: dupe ? "duplicate" : "ready",
      warnings,
      input: {
        householdName: name,
        assignedAdvisor: advisor,
        tier,
        redtailId,
        lastMeetingDate,
        lastCallDate,
      },
    });
  });

  return {
    rows,
    readyCount: rows.filter((r) => r.status === "ready").length,
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
  "Household Name,Advisor,Revenue,Last Meeting,Last Call,Redtail ID",
  '"Whitfield, Daniel & Mara",Matt,18500,3/14/2026,5/28/2026,48200',
  '"Castellanos Family",Advisor B,9200,1/9/2026,4/2/2026,48237',
  '"Abernathy, Gordon",Joint,2400,11/20/2025,2/13/2026,48274',
].join("\n");
