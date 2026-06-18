// Clients — browse the book, add households by hand (Phase 1), click
// through to profiles.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { latestContactFor, nextDueFor } from "../lib/selectors";
import { clientScore } from "../engine/serviceEngine";
import { outreachCandidates } from "../engine/outreach";
import { ADVISOR_LABELS, TIERS, TIER_RANK, type AdvisorAssignment, type Tier } from "../types";
import { formatShort } from "../lib/dates";
import { AdvisorChip, DuePhrase, ScorePill, TierBadge } from "../components/badges";
import { ClientFormModal } from "../components/ClientFormModal";
import { PlanOutreachModal } from "../components/PlanOutreachModal";
import { LinkFamiliesModal } from "../components/LinkFamiliesModal";
import { planSurnameLinks } from "../lib/familyLink";
import { EmptyState } from "../components/EmptyState";
import { Button, Input, Select } from "../components/ui";
import { PlusIcon, SearchIcon, SunriseIcon, UsersIcon } from "../components/icons";

type ClientSortKey = "household" | "tier" | "score";

export function Clients() {
  const { data, today, currentUser } = useApp();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [linking, setLinking] = useState(false);

  const neverContacted = useMemo(
    () => (data ? outreachCandidates(data.clients, data.contactEvents, data.dueDates).length : 0),
    [data],
  );

  // Same-surname households that could be grouped into families — within a
  // book only, so different advisors' clients never merge.
  const linkableFamilies = useMemo(() => (data ? planSurnameLinks(data.clients).length : 0), [data]);

  // Same household appearing in more than one book — usually a CSV that mixed
  // advisors. Surface them so the wrong-book copy can be deleted.
  const duplicateGroups = useMemo(() => {
    if (!data) return [];
    const byName = new Map<string, typeof data.clients>();
    for (const c of data.clients) {
      const key = c.householdName.trim().toLowerCase();
      const g = byName.get(key);
      if (g) g.push(c);
      else byName.set(key, [c]);
    }
    return [...byName.values()].filter((g) => g.length > 1);
  }, [data]);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | Tier>("all");
  // Default to the signed-in advisor's own book so they don't reset the
  // dropdown every visit; the assistant defaults to everyone.
  const [advisorFilter, setAdvisorFilter] = useState<"all" | AdvisorAssignment>(
    () => currentUser?.advisorKey ?? "all",
  );
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState<{ key: ClientSortKey; dir: 1 | -1 }>({
    key: "household",
    dir: 1,
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const mapped = data.clients
      .filter((c) => showInactive || c.active)
      .filter((c) => tierFilter === "all" || c.tier === tierFilter)
      .filter((c) => advisorFilter === "all" || c.assignedAdvisor === advisorFilter)
      .filter((c) => !q || c.householdName.toLowerCase().includes(q))
      .map((client) => ({
        client,
        lastContact: latestContactFor(data.contactEvents, client.id),
        nextDue: nextDueFor(data.dueDates, client.id),
        score: clientScore(client, data.contactEvents, data.serviceModels, today).score,
      }));

    const byName = (a: typeof mapped[number], b: typeof mapped[number]) =>
      a.client.householdName.localeCompare(b.client.householdName);
    return mapped.sort((a, b) => {
      let primary = 0;
      if (sort.key === "household") primary = byName(a, b);
      else if (sort.key === "tier") primary = TIER_RANK[a.client.tier] - TIER_RANK[b.client.tier];
      else primary = a.score - b.score;
      return (primary || byName(a, b)) * sort.dir;
    });
  }, [data, search, tierFilter, advisorFilter, showInactive, today, sort]);

  const toggleSort = (key: ClientSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  if (!data) return null;

  const activeCount = data.clients.filter((c) => c.active).length;

  return (
    <div className="animate-rise space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            {activeCount} active {activeCount === 1 ? "household" : "households"} on the service
            schedule.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {linkableFamilies > 0 && (
            <Button onClick={() => setLinking(true)}>
              <UsersIcon className="size-4" />
              Link families
            </Button>
          )}
          <Button onClick={() => navigate("/clients/import")}>Import CSV</Button>
          <Button variant="primary" onClick={() => setAdding(true)}>
            <PlusIcon className="size-4" />
            Add household
          </Button>
        </div>
      </header>

      {neverContacted > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold-300 bg-gold-50 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold-100 text-gold-700">
              <SunriseIcon className="size-5" />
            </span>
            <p className="text-sm leading-snug text-gold-900">
              <span className="font-semibold">
                {neverContacted} {neverContacted === 1 ? "household has" : "households have"}
              </span>{" "}
              never been contacted — invisible to your queue until you reach out.
            </p>
          </div>
          <Button variant="primary" onClick={() => setPlanning(true)}>
            Plan initial outreach
          </Button>
        </div>
      )}

      {duplicateGroups.length > 0 && (
        <div className="rounded-xl border border-clay-300 bg-clay-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm leading-snug text-clay-900">
              <span className="font-semibold">
                {duplicateGroups.length} {duplicateGroups.length === 1 ? "household appears" : "households appear"} in more than one book
              </span>{" "}
              — likely a CSV that mixed advisors. Open the wrong copy and delete it.
            </p>
            <Button variant="secondary" onClick={() => setShowDuplicates((v) => !v)}>
              {showDuplicates ? "Hide" : "Review duplicates"}
            </Button>
          </div>
          {showDuplicates && (
            <ul className="mt-3 space-y-2">
              {duplicateGroups.map((group) => (
                <li key={group[0].householdName} className="rounded-lg bg-white p-2.5">
                  <p className="text-[13px] font-semibold">{group[0].householdName}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {group.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => navigate(`/clients/${c.id}`)}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-stone-200 px-2 py-1 text-xs hover:bg-stone-50"
                      >
                        <TierBadge tier={c.tier} />
                        <AdvisorChip advisor={c.assignedAdvisor} />
                        {!c.active && <span className="text-stone-400">inactive</span>}
                        <span className="text-stone-400">→</span>
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-2.5 left-3 size-4 text-stone-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search households…"
            className="w-56 pl-9"
          />
        </div>
        <div className="w-32">
          <Select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value as "all" | Tier)}
            aria-label="Filter by tier"
          >
            <option value="all">All tiers</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                Tier {t}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select
            value={advisorFilter}
            onChange={(e) => setAdvisorFilter(e.target.value as "all" | AdvisorAssignment)}
            aria-label="Filter by advisor"
          >
            <option value="all">All advisors</option>
            {(Object.keys(ADVISOR_LABELS) as AdvisorAssignment[]).map((k) => (
              <option key={k} value={k}>
                {ADVISOR_LABELS[k]}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-soft select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="size-4 cursor-pointer accent-pine-700"
          />
          Show inactive
        </label>
      </div>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            icon={<UsersIcon className="size-5" />}
            title={data.clients.length === 0 ? "No households yet" : "No matches"}
            hint={
              data.clients.length === 0
                ? "Start with your top 10–15 clients — add them by hand and begin logging."
                : "Try widening the filters."
            }
          />
        ) : (
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50/60 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                <SortHeader label="Household" sortKey="household" sort={sort} onSort={toggleSort} />
                <SortHeader label="Tier" sortKey="tier" sort={sort} onSort={toggleSort} />
                <th className="px-4 py-2.5">Advisor</th>
                <th className="px-4 py-2.5">Last contact</th>
                <th className="px-4 py-2.5">Next due</th>
                <SortHeader label="Service score" sortKey="score" sort={sort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ client, lastContact, nextDue, score }) => (
                <tr
                  key={client.id}
                  onClick={() => navigate(`/clients/${client.id}`)}
                  className="cursor-pointer border-b border-stone-100 transition-colors last:border-0 hover:bg-pine-50/50"
                >
                  <td className="px-4 py-3">
                    <span className="font-semibold">{client.householdName}</span>
                    {!client.active && (
                      <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-semibold text-stone-600 uppercase">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <TierBadge tier={client.tier} />
                  </td>
                  <td className="px-4 py-3">
                    <AdvisorChip advisor={client.assignedAdvisor} />
                  </td>
                  <td className="tnum px-4 py-3 text-[13px] text-ink-soft">
                    {lastContact ? formatShort(lastContact.eventDate) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {nextDue && client.active ? (
                      <DuePhrase dueDate={nextDue.dueDate} today={today} />
                    ) : (
                      <span className="text-[13px] text-stone-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ScorePill score={score} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ClientFormModal open={adding} onClose={() => setAdding(false)} />
      {planning && <PlanOutreachModal onClose={() => setPlanning(false)} />}
      {linking && <LinkFamiliesModal onClose={() => setLinking(false)} />}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: ClientSortKey;
  sort: { key: ClientSortKey; dir: 1 | -1 };
  onSort: (key: ClientSortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th className="px-4 py-2.5">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold tracking-wider text-ink-soft uppercase hover:text-ink"
      >
        {label}
        {active && <span className="text-pine-600">{sort.dir === 1 ? "↓" : "↑"}</span>}
      </button>
    </th>
  );
}
