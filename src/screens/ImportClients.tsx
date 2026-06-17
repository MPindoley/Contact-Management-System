// Phase 2: one-time CSV import. Upload the Redtail export, map its columns,
// set the revenue cutoffs for tiers (the most important configuration step
// in the whole project), preview, import. Due dates go live immediately
// because every row seeds real last-contact events.

import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { useToast } from "../lib/toast";
import {
  buildImportPreview,
  CSV_TEMPLATE,
  distinctAdvisorValues,
  guessMapping,
  parseCsv,
  type ColumnMapping,
  type ImportField,
  type ImportRowStatus,
  type ParsedCsv,
} from "../lib/importCsv";
import { ADVISOR_LABELS, TIERS, type AdvisorAssignment, type Tier } from "../types";
import { TierBadge, AdvisorChip } from "../components/badges";
import { Button, Field, Select, Spinner } from "../components/ui";
import { CheckCircleIcon, UsersIcon } from "../components/icons";

const FIELD_LABELS: Array<{ field: ImportField; label: string; hint: string }> = [
  { field: "householdName", label: "Household name", hint: "Required — rows without one are skipped." },
  { field: "advisor", label: "Advisor", hint: "Map each value below once chosen." },
  { field: "tier", label: "Tier (S/A/B/C)", hint: "If your file already has tiers." },
  { field: "revenue", label: "Revenue / AUM", hint: "Used to auto-assign tiers by cutoff." },
  { field: "phone", label: "Phone number", hint: "Shows up when a call is due." },
  { field: "heldAway", label: "Money to capture", hint: "yes/x flags held-away assets." },
  { field: "lastMeetingDate", label: "Last meeting date", hint: "Starts the meeting clock." },
  { field: "lastCallDate", label: "Last call date", hint: "Starts the call clock." },
  { field: "redtailId", label: "Redtail ID", hint: "For the future live sync." },
];

export function ImportClients() {
  const { data, importClients, autoLinkBySurname, busy } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [defaultAdvisor, setDefaultAdvisor] = useState<AdvisorAssignment>("matt");
  const [defaultTier, setDefaultTier] = useState<Tier>("B");
  const [advisorValueMap, setAdvisorValueMap] = useState<Record<string, AdvisorAssignment>>({});
  const [applyUpdates, setApplyUpdates] = useState(true);
  const [autoLink, setAutoLink] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  async function onFile(file: File) {
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setParseError("That file looks empty — export your households to CSV and try again.");
        return;
      }
      setParseError(null);
      setFileName(file.name);
      setCsv(parsed);
      const guessed = guessMapping(parsed.headers);
      setMapping(guessed);
      // Pre-map advisor values that obviously match.
      const values = distinctAdvisorValues(parsed, guessed);
      const auto: Record<string, AdvisorAssignment> = {};
      for (const v of values) {
        const lower = v.toLowerCase();
        if (/matt/.test(lower)) auto[lower] = "matt";
        else if (/joint|both|shared/.test(lower)) auto[lower] = "joint";
        else if (/beau|advisor ?b|b$/.test(lower)) auto[lower] = "advisor_b";
      }
      setAdvisorValueMap(auto);
    } catch {
      setParseError("Couldn't read that file. Make sure it's a .csv export.");
    }
  }

  const advisorValues = useMemo(
    () => (csv ? distinctAdvisorValues(csv, mapping) : []),
    [csv, mapping],
  );

  // Auto-tiering follows the SAVED criteria from the Tiers screen (one source
  // of truth) — only when a revenue column is mapped and no explicit tier one.
  const tierCriteria = useMemo(() => {
    if (!data || mapping.revenue === undefined || mapping.tier !== undefined) return null;
    return data.serviceModels.map((m) => ({ tier: m.tier, minRevenue: m.minRevenue }));
  }, [data, mapping.revenue, mapping.tier]);

  const preview = useMemo(() => {
    if (!csv || mapping.householdName === undefined || !data) return null;
    return buildImportPreview(csv, {
      mapping,
      defaultAdvisor,
      defaultTier,
      advisorValueMap,
      tierCriteria,
      applyUpdates,
      existingClients: data.clients.map((c) => ({
        id: c.id,
        householdName: c.householdName,
        tier: c.tier,
        assignedAdvisor: c.assignedAdvisor,
        phone: c.phone,
        redtailId: c.redtailId,
        revenue: c.revenue,
        heldAway: c.heldAway,
      })),
    });
  }, [csv, mapping, defaultAdvisor, defaultTier, advisorValueMap, tierCriteria, applyUpdates, data]);

  async function runImport() {
    if (!preview || preview.newCount + preview.updateCount === 0) return;
    const creates = preview.rows.filter((r) => r.status === "new").map((r) => r.input!);
    const updates = preview.rows
      .filter((r) => r.status === "update")
      .map((r) => ({ id: r.existingId!, patch: r.patch! }));
    try {
      await importClients(creates, updates);
      if (autoLink) await autoLinkBySurname();
      const parts: string[] = [];
      if (creates.length) parts.push(`${creates.length} added`);
      if (updates.length) parts.push(`${updates.length} updated`);
      toast.push(
        `Import complete — ${parts.join(" · ")}.${autoLink ? " Same-surname households linked." : ""} Contact history untouched.`,
      );
      navigate("/clients");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Import failed partway — check the Clients list before retrying.", "error");
    }
  }

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "relationship-hub-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!data) return null;

  return (
    <div className="animate-rise space-y-6">
      <header>
        <Link to="/clients" className="text-[13px] font-medium text-ink-soft hover:text-ink hover:underline">
          ← Clients
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Import households</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-ink-soft">
          One-time CSV import from Redtail (or any spreadsheet). Last-contact dates seed the
          service clocks, so the morning dashboard is accurate the moment this finishes.
        </p>
      </header>

      {/* Step 1 — file */}
      <section className="card p-5">
        <StepHeading n={1} title="Choose your CSV" done={Boolean(csv)} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
          <Button variant="primary" onClick={() => fileRef.current?.click()}>
            {csv ? "Choose a different file" : "Choose CSV file"}
          </Button>
          {fileName && (
            <span className="text-sm text-ink-soft">
              <span className="font-medium text-ink">{fileName}</span> · {csv?.rows.length} rows
            </span>
          )}
          <button
            type="button"
            onClick={downloadTemplate}
            className="cursor-pointer text-xs text-ink-soft underline-offset-2 hover:underline"
          >
            Download a starter template
          </button>
        </div>
        {parseError && (
          <p className="mt-3 rounded-lg bg-clay-50 px-3 py-2 text-sm text-clay-800">{parseError}</p>
        )}
        <p className="mt-3 text-xs leading-relaxed text-stone-400">
          From Redtail: Contacts → select all → Exports → CSV. Include household name, advisor,
          AUM/revenue, and last meeting / last call dates if you have them. Extra columns are fine —
          you'll pick what matters next.
        </p>
      </section>

      {/* Step 2 — mapping */}
      {csv && (
        <section className="card p-5">
          <StepHeading n={2} title="Match your columns" done={mapping.householdName !== undefined} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FIELD_LABELS.map(({ field, label, hint }) => (
              <Field key={field} label={label} hint={hint}>
                <Select
                  value={mapping[field] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setMapping((m) => {
                      const next = { ...m };
                      if (v === "") delete next[field];
                      else next[field] = Number(v);
                      return next;
                    });
                  }}
                >
                  <option value="">— not in my file —</option>
                  {csv.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>

          {mapping.householdName === undefined && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Pick which column holds the household name — that's the only required one.
            </p>
          )}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {mapping.advisor === undefined ? (
              <Field label="Advisor for every imported household" hint="No advisor column mapped.">
                <Select
                  value={defaultAdvisor}
                  onChange={(e) => setDefaultAdvisor(e.target.value as AdvisorAssignment)}
                >
                  {(Object.keys(ADVISOR_LABELS) as AdvisorAssignment[]).map((k) => (
                    <option key={k} value={k}>
                      {ADVISOR_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <div>
                <p className="mb-1.5 text-[13px] font-medium text-ink-soft">
                  Match advisor values from your file
                </p>
                <div className="space-y-2 rounded-lg border border-stone-200 p-3">
                  {advisorValues.map((v) => (
                    <div key={v} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{v}</span>
                      <div className="w-44 shrink-0">
                        <Select
                          value={advisorValueMap[v.toLowerCase()] ?? ""}
                          onChange={(e) =>
                            setAdvisorValueMap((m) => ({
                              ...m,
                              [v.toLowerCase()]: e.target.value as AdvisorAssignment,
                            }))
                          }
                        >
                          <option value="">→ {ADVISOR_LABELS[defaultAdvisor]} (default)</option>
                          {(Object.keys(ADVISOR_LABELS) as AdvisorAssignment[]).map((k) => (
                            <option key={k} value={k}>
                              {ADVISOR_LABELS[k]}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mapping.tier !== undefined ? (
              <Field label="Tier" hint="Using the tier column from your file.">
                <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-ink-soft">
                  Values like “A”, “Tier B”, “c” are recognized automatically.
                </div>
              </Field>
            ) : mapping.revenue !== undefined ? (
              <div>
                <p className="mb-1.5 text-[13px] font-medium text-ink-soft">
                  Tiers from your saved criteria
                </p>
                <div className="space-y-1.5 rounded-lg border border-stone-200 p-3">
                  {data.serviceModels.map((m) => (
                    <p key={m.tier} className="flex items-center gap-2 text-sm">
                      <TierBadge tier={m.tier} />
                      <span className="text-ink-soft">
                        {m.minRevenue != null ? `revenue at or above ${formatMoney(m.minRevenue)}` : "everyone below"}
                      </span>
                    </p>
                  ))}
                  {preview && (
                    <p className="tnum border-t border-stone-100 pt-2 text-[13px] font-medium">
                      New: {preview.tierCounts.S} S · {preview.tierCounts.A} A ·{" "}
                      {preview.tierCounts.B} B · {preview.tierCounts.C} C
                    </p>
                  )}
                  <p className="text-xs text-stone-400">
                    Edit these floors on the <Link to="/settings/service-models" className="underline underline-offset-2">Tiers &amp; service models</Link> screen.
                  </p>
                </div>
              </div>
            ) : (
              <Field label="Tier for every imported household" hint="No tier or revenue column mapped.">
                <Select value={defaultTier} onChange={(e) => setDefaultTier(e.target.value as Tier)}>
                  {TIERS.map((t) => (
                    <option key={t} value={t}>
                      Tier {t}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </section>
      )}

      {/* Step 3 — preview & import */}
      {preview && (
        <section className="card p-5">
          <StepHeading n={3} title="Review and import" done={false} />

          <div className="mt-3 space-y-2">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 select-none">
              <input
                type="checkbox"
                checked={applyUpdates}
                onChange={(e) => setApplyUpdates(e.target.checked)}
                className="mt-0.5 size-4 cursor-pointer accent-pine-700"
              />
              <span className="text-[13px] leading-snug text-ink">
                <span className="font-medium">Update existing households where the CSV differs</span>
                <span className="block text-xs text-stone-400">
                  Changes tier, advisor, phone, and AUM only — logged contact history and service
                  clocks are never touched.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 select-none">
              <input
                type="checkbox"
                checked={autoLink}
                onChange={(e) => setAutoLink(e.target.checked)}
                className="mt-0.5 size-4 cursor-pointer accent-pine-700"
              />
              <span className="text-[13px] leading-snug text-ink">
                <span className="font-medium">Link households that share a last name into families</span>
                <span className="block text-xs text-stone-400">
                  Last-name matching is fuzzy — review and fix any wrong links on the profiles
                  afterward.
                </span>
              </span>
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5 font-medium text-pine-800">
              <CheckCircleIcon className="size-4" /> {preview.newCount} new
            </span>
            <span className="font-medium text-amber-800">{preview.updateCount} to update</span>
            {preview.unchangedCount > 0 && (
              <span className="text-ink-soft">{preview.unchangedCount} unchanged</span>
            )}
            {preview.duplicateCount > 0 && (
              <span className="text-ink-soft">{preview.duplicateCount} repeated in file</span>
            )}
            {preview.skippedNoName > 0 && (
              <span className="text-ink-soft">{preview.skippedNoName} without a name</span>
            )}
            {preview.newCount > 0 && (
              <span className="tnum text-ink-soft">
                new: {preview.tierCounts.A} A · {preview.tierCounts.B} B · {preview.tierCounts.C} C
              </span>
            )}
          </div>

          <div className="mt-4 max-h-80 overflow-y-auto rounded-lg border border-stone-200">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-stone-50">
                <tr className="border-b border-stone-200 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                  <th className="px-3 py-2">Household</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Tier</th>
                  <th className="px-3 py-2">Advisor</th>
                  <th className="px-3 py-2">What changes</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 250).map((r) => (
                  <tr
                    key={r.line}
                    className={`border-b border-stone-100 last:border-0 ${
                      r.status === "duplicate" || r.status === "unchanged" ? "opacity-50" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-medium">{r.householdName}</td>
                    <td className="px-3 py-2">
                      <ImportStatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2">
                      {r.input ? (
                        <TierBadge tier={r.input.tier} />
                      ) : r.patch?.tier ? (
                        <TierBadge tier={r.patch.tier} />
                      ) : (
                        <span className="text-xs text-stone-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.input ? (
                        <AdvisorChip advisor={r.input.assignedAdvisor} />
                      ) : (
                        <span className="text-xs text-stone-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-soft">
                      {r.status === "update"
                        ? r.changes.join(" · ")
                        : r.status === "duplicate"
                          ? "repeated earlier in the file"
                          : r.status === "unchanged"
                            ? "already matches"
                            : r.warnings.join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.rows.length > 250 && (
              <p className="border-t border-stone-100 px-3 py-2 text-center text-xs text-stone-400">
                Showing the first 250 of {preview.rows.length} rows — the import covers them all.
              </p>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-stone-400">
              New households without last-contact dates get no due dates until you log their first
              touch — nothing is invented, and updates never alter contact history.
            </p>
            <Button
              variant="primary"
              disabled={preview.newCount + preview.updateCount === 0 || busy}
              onClick={() => void runImport()}
            >
              {busy && <Spinner className="size-3.5 border-white/40 border-t-white" />}
              <UsersIcon className="size-4" />
              {importButtonLabel(preview.newCount, preview.updateCount)}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

const STATUS_BADGE: Record<ImportRowStatus, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-pine-100 text-pine-800" },
  update: { label: "Update", cls: "bg-amber-100 text-amber-800" },
  unchanged: { label: "Unchanged", cls: "bg-stone-100 text-stone-500" },
  duplicate: { label: "Repeat", cls: "bg-stone-100 text-stone-400" },
};

function ImportStatusBadge({ status }: { status: ImportRowStatus }) {
  const s = STATUS_BADGE[status];
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>
      {s.label}
    </span>
  );
}

function importButtonLabel(newCount: number, updateCount: number): string {
  const parts: string[] = [];
  if (newCount) parts.push(`Add ${newCount}`);
  if (updateCount) parts.push(`update ${updateCount}`);
  return parts.length === 0 ? "Nothing to apply" : parts.join(" · ");
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

function StepHeading({ n, title, done }: { n: number; title: string; done: boolean }) {
  return (
    <h2 className="flex items-center gap-2.5 text-sm font-semibold">
      <span
        className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${
          done ? "bg-pine-700 text-white" : "bg-stone-200 text-ink-soft"
        }`}
      >
        {done ? "✓" : n}
      </span>
      {title}
    </h2>
  );
}
