// Clients — browse the book, add households by hand (Phase 1), click
// through to profiles.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { latestContactFor, nextDueFor } from "../lib/selectors";
import { clientScore } from "../engine/serviceEngine";
import { ADVISOR_LABELS, type AdvisorAssignment, type Tier } from "../types";
import { formatShort } from "../lib/dates";
import { AdvisorChip, DuePhrase, ScorePill, TierBadge } from "../components/badges";
import { ClientFormModal } from "../components/ClientFormModal";
import { EmptyState } from "../components/EmptyState";
import { Button, Input, Select } from "../components/ui";
import { PlusIcon, SearchIcon, UsersIcon } from "../components/icons";

export function Clients() {
  const { data, today } = useApp();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | Tier>("all");
  const [advisorFilter, setAdvisorFilter] = useState<"all" | AdvisorAssignment>("all");
  const [showInactive, setShowInactive] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.clients
      .filter((c) => showInactive || c.active)
      .filter((c) => tierFilter === "all" || c.tier === tierFilter)
      .filter((c) => advisorFilter === "all" || c.assignedAdvisor === advisorFilter)
      .filter((c) => !q || c.householdName.toLowerCase().includes(q))
      .map((client) => ({
        client,
        lastContact: latestContactFor(data.contactEvents, client.id),
        nextDue: nextDueFor(data.dueDates, client.id),
        score: clientScore(client, data.contactEvents, data.serviceModels, today).score,
      }))
      .sort((a, b) => a.client.householdName.localeCompare(b.client.householdName));
  }, [data, search, tierFilter, advisorFilter, showInactive, today]);

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
          <Button onClick={() => navigate("/clients/import")}>Import CSV</Button>
          <Button variant="primary" onClick={() => setAdding(true)}>
            <PlusIcon className="size-4" />
            Add household
          </Button>
        </div>
      </header>

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
            <option value="A">Tier A</option>
            <option value="B">Tier B</option>
            <option value="C">Tier C</option>
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
                <th className="px-4 py-2.5">Household</th>
                <th className="px-4 py-2.5">Tier</th>
                <th className="px-4 py-2.5">Advisor</th>
                <th className="px-4 py-2.5">Last contact</th>
                <th className="px-4 py-2.5">Next due</th>
                <th className="px-4 py-2.5">Service score</th>
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
    </div>
  );
}
