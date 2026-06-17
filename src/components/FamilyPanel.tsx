// Family linking on the Client Profile: see linked households, their roles,
// combined assets, and the tier the saved criteria suggest for the combined
// total (one click to apply to everyone). Individual profiles stay intact.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Client, FamilyRole } from "../types";
import { FAMILY_ROLES, FAMILY_ROLE_LABELS } from "../types";
import { useApp } from "../lib/store";
import { useToast } from "../lib/toast";
import { tierFromCriteria } from "../lib/importCsv";
import { TierBadge } from "./badges";
import { Button, Input, Select } from "./ui";
import { SearchIcon, UsersIcon, XIcon } from "./icons";

function money(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

export function FamilyPanel({ client }: { client: Client }) {
  const { data, linkFamily, unlinkFromFamily, renameFamily, updateClient, busy } = useApp();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const family = data?.families.find((f) => f.id === client.familyId) ?? null;
  const members = useMemo(
    () => (data && family ? data.clients.filter((c) => c.familyId === family.id) : []),
    [data, family],
  );

  const combined = useMemo(
    () => members.reduce((sum, m) => sum + (m.revenue ?? 0), 0),
    [members],
  );
  const suggestedTier = useMemo(() => {
    if (!data || members.length === 0 || combined === 0) return null;
    return tierFromCriteria(
      combined,
      data.serviceModels.map((m) => ({ tier: m.tier, minRevenue: m.minRevenue })),
    );
  }, [data, members, combined]);

  const candidates = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return data.clients
      .filter((c) => c.id !== client.id)
      // Exclude only households already in THIS client's family.
      .filter((c) => !(client.familyId && c.familyId === client.familyId))
      .filter((c) => c.householdName.toLowerCase().includes(q))
      .slice(0, 6);
  }, [data, query, client]);

  if (!data) return null;

  async function linkWith(other: Client) {
    setQuery("");
    try {
      // Join the other household's family if it has one; else start a new one.
      await linkFamily([client.id, other.id], other.familyId ?? null, null, {
        [client.id]: client.familyRole ?? "head",
        [other.id]: other.familyRole ?? "spouse",
      });
      toast.push(`${client.householdName} linked with ${other.householdName}.`);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't link the household.", "error");
    }
  }

  async function applyTierToAll(tier: typeof suggestedTier) {
    if (!tier) return;
    try {
      for (const m of members) {
        if (m.tier !== tier) await updateClient(m.id, { tier });
      }
      toast.push(`Whole family set to Tier ${tier}.`);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't apply the tier.", "error");
    }
  }

  // --- Not in a family yet: offer to link ---
  if (!family) {
    return (
      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <UsersIcon className="size-4 text-stone-400" />
          Family
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
          Link spouses or family members so you can see their combined assets and tier them
          together. Individual profiles stay separate.
        </p>
        <div className="relative mt-3">
          <SearchIcon className="pointer-events-none absolute top-2.5 left-3 size-4 text-stone-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Link to another household…"
            className="pl-9"
          />
        </div>
        {candidates.length > 0 && (
          <div className="mt-1.5 overflow-hidden rounded-lg border border-stone-200">
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={busy}
                onClick={() => void linkWith(c)}
                className="flex w-full cursor-pointer items-center gap-2 border-b border-stone-100 px-3 py-2 text-left text-sm transition-colors last:border-0 hover:bg-pine-50"
              >
                <TierBadge tier={c.tier} />
                <span className="flex-1 truncate font-medium">{c.householdName}</span>
                {c.familyId && <span className="text-xs text-stone-400">in a family</span>}
              </button>
            ))}
          </div>
        )}
      </section>
    );
  }

  // --- In a family ---
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-2">
        {renaming ? (
          <form
            className="flex flex-1 items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void renameFamily(family.id, nameDraft).then(() => setRenaming(false));
            }}
          >
            <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus className="py-1" />
            <Button size="sm" variant="primary" type="submit">Save</Button>
          </form>
        ) : (
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <UsersIcon className="size-4 text-stone-400" />
            {family.name}
            <button
              type="button"
              onClick={() => { setNameDraft(family.name); setRenaming(true); }}
              className="cursor-pointer text-xs font-normal text-stone-400 underline-offset-2 hover:text-ink hover:underline"
            >
              rename
            </button>
          </h2>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-2 rounded-lg bg-stone-50 px-2.5 py-2">
            <TierBadge tier={m.tier} />
            <div className="min-w-0 flex-1">
              {m.id === client.id ? (
                <span className="text-[13px] font-semibold">{m.householdName}</span>
              ) : (
                <Link to={`/clients/${m.id}`} className="text-[13px] font-semibold hover:underline">
                  {m.householdName}
                </Link>
              )}
              <span className="block text-xs text-stone-400">{money(m.revenue)} AUM</span>
            </div>
            <div className="w-28 shrink-0">
              <Select
                value={m.familyRole ?? "other"}
                onChange={(e) => void updateClient(m.id, { familyRole: e.target.value as FamilyRole })}
                className="py-1 text-xs"
                aria-label={`Role for ${m.householdName}`}
              >
                {FAMILY_ROLES.map((r) => (
                  <option key={r} value={r}>{FAMILY_ROLE_LABELS[r]}</option>
                ))}
              </Select>
            </div>
            <button
              type="button"
              title="Remove from family"
              onClick={() => void unlinkFromFamily(m.id)}
              className="shrink-0 cursor-pointer rounded-md p-1 text-stone-400 hover:bg-stone-200 hover:text-clay-700"
            >
              <XIcon className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 rounded-lg border border-stone-200 p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-ink-soft">Combined assets</span>
          <span className="tnum font-display text-lg font-semibold">{money(combined)}</span>
        </div>
        {suggestedTier && (
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-stone-100 pt-2">
            <span className="flex items-center gap-1.5 text-[13px] text-ink-soft">
              Suggested: <TierBadge tier={suggestedTier} /> from combined
            </span>
            {members.some((m) => m.tier !== suggestedTier) && (
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void applyTierToAll(suggestedTier)}>
                Apply to all
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="relative mt-3">
        <SearchIcon className="pointer-events-none absolute top-2.5 left-3 size-4 text-stone-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Add another household…"
          className="pl-9"
        />
      </div>
      {candidates.length > 0 && (
        <div className="mt-1.5 overflow-hidden rounded-lg border border-stone-200">
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busy}
              onClick={() => void linkFamily([c.id], family.id, null, { [c.id]: "other" })}
              className="flex w-full cursor-pointer items-center gap-2 border-b border-stone-100 px-3 py-2 text-left text-sm transition-colors last:border-0 hover:bg-pine-50"
            >
              <TierBadge tier={c.tier} />
              <span className="flex-1 truncate font-medium">{c.householdName}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
