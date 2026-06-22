// Prospects — a separate pipeline for people you're calling who aren't
// clients yet. Tracked entirely apart from the client service engine: no due
// dates, no scores, nothing that can move a client graph.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { useStickyState } from "../lib/stickyState";
import {
  ADVISOR_LABELS,
  PROSPECT_STATUS_LABELS,
  type AdvisorAssignment,
  type Prospect,
  type ProspectEvent,
  type ProspectStatus,
} from "../types";
import { formatShort, todayISO } from "../lib/dates";
import { AdvisorChip, ProspectStatusBadge } from "../components/badges";
import { PhoneLink } from "../components/PhoneLink";
import { ProspectFormModal } from "../components/ProspectFormModal";
import { EmptyState } from "../components/EmptyState";
import { Button, Input, Select } from "../components/ui";
import { PlusIcon, SearchIcon, TargetIcon, VoicemailIcon } from "../components/icons";

interface ProspectRow {
  prospect: Prospect;
  attempts: number;
  voicemails: number;
  lastAttempt: ProspectEvent | null;
}

const STATUS_ORDER: Record<ProspectStatus, number> = {
  appointment: 0,
  working: 1,
  new: 2,
  converted: 3,
  lost: 4,
};

export function Prospects() {
  const { data, currentUser } = useApp();
  const navigate = useNavigate();
  const today = todayISO();
  const [adding, setAdding] = useState(false);
  // Sticky per user for the session — hold while navigating, reset on reload.
  const fk = `prospects:${currentUser?.id ?? "anon"}`;
  const [search, setSearch] = useStickyState(`${fk}:search`, "");
  const [statusFilter, setStatusFilter] = useStickyState<"open" | "all" | ProspectStatus>(
    `${fk}:status`,
    "open",
  );
  const [advisorFilter, setAdvisorFilter] = useStickyState<"all" | AdvisorAssignment>(
    `${fk}:advisor`,
    () => currentUser?.advisorKey ?? "all",
  );

  const rows = useMemo<ProspectRow[]>(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const eventsByProspect = new Map<string, ProspectEvent[]>();
    for (const e of data.prospectEvents) {
      const list = eventsByProspect.get(e.prospectId);
      if (list) list.push(e);
      else eventsByProspect.set(e.prospectId, [e]);
    }

    return data.prospects
      .filter((p) => {
        if (statusFilter === "open") return p.status !== "converted" && p.status !== "lost";
        if (statusFilter === "all") return true;
        return p.status === statusFilter;
      })
      .filter((p) => advisorFilter === "all" || p.assignedAdvisor === advisorFilter)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .map((prospect) => {
        const events = eventsByProspect.get(prospect.id) ?? [];
        const sorted = [...events].sort(
          (a, b) => b.eventDate.localeCompare(a.eventDate) || b.createdAt.localeCompare(a.createdAt),
        );
        return {
          prospect,
          attempts: events.filter((e) => e.type !== "note").length,
          voicemails: events.filter((e) => e.type === "voicemail").length,
          lastAttempt: sorted[0] ?? null,
        };
      })
      .sort((a, b) => {
        const s = STATUS_ORDER[a.prospect.status] - STATUS_ORDER[b.prospect.status];
        if (s !== 0) return s;
        // Within a status, soonest follow-up first (nulls last).
        const af = a.prospect.nextFollowUp ?? "9999";
        const bf = b.prospect.nextFollowUp ?? "9999";
        return af.localeCompare(bf) || a.prospect.name.localeCompare(b.prospect.name);
      });
  }, [data, search, statusFilter, advisorFilter]);

  if (!data) return null;

  const openCount = data.prospects.filter((p) => p.status !== "converted" && p.status !== "lost").length;
  const dueCount = data.prospects.filter(
    (p) => p.nextFollowUp && p.nextFollowUp <= today && p.status !== "converted" && p.status !== "lost",
  ).length;

  return (
    <div className="animate-rise space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Prospects</h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            {openCount} in your pipeline{dueCount > 0 ? ` · ${dueCount} due to follow up` : ""}.
            Tracked separately from your clients.
          </p>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <PlusIcon className="size-4" />
          Add prospect
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-2.5 left-3 size-4 text-stone-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search prospects…"
            className="w-56 pl-9"
          />
        </div>
        <div className="w-40">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            aria-label="Filter by status"
          >
            <option value="open">Open pipeline</option>
            <option value="all">All statuses</option>
            {(Object.keys(PROSPECT_STATUS_LABELS) as ProspectStatus[]).map((s) => (
              <option key={s} value={s}>
                {PROSPECT_STATUS_LABELS[s]}
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
      </div>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            icon={<TargetIcon className="size-5" />}
            title={data.prospects.length === 0 ? "No prospects yet" : "No matches"}
            hint={
              data.prospects.length === 0
                ? "Add the people you've been calling — track every attempt and voicemail here."
                : "Try widening the filters."
            }
          />
        ) : (
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50/60 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                <th className="px-4 py-2.5">Prospect</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Advisor</th>
                <th className="px-4 py-2.5">Attempts</th>
                <th className="px-4 py-2.5">Last attempt</th>
                <th className="px-4 py-2.5">Follow up</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ prospect, attempts, voicemails, lastAttempt }) => {
                const due = prospect.nextFollowUp && prospect.nextFollowUp <= today;
                return (
                  <tr
                    key={prospect.id}
                    onClick={() => navigate(`/prospects/${prospect.id}`)}
                    className="cursor-pointer border-b border-stone-100 transition-colors last:border-0 hover:bg-pine-50/50"
                  >
                    <td className="px-4 py-3">
                      <span className="font-semibold">{prospect.name}</span>
                      {prospect.phone && <PhoneLink phone={prospect.phone} className="mt-0.5 text-[13px]" />}
                    </td>
                    <td className="px-4 py-3">
                      <ProspectStatusBadge status={prospect.status} />
                    </td>
                    <td className="px-4 py-3">
                      <AdvisorChip advisor={prospect.assignedAdvisor} />
                    </td>
                    <td className="tnum px-4 py-3 text-ink-soft">
                      <span className="flex items-center gap-2">
                        {attempts}
                        {voicemails > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-violet-700">
                            <VoicemailIcon className="size-3.5" />
                            {voicemails}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="tnum px-4 py-3 text-[13px] text-ink-soft">
                      {lastAttempt ? formatShort(lastAttempt.eventDate) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {prospect.nextFollowUp ? (
                        <span
                          className={`text-[13px] font-medium ${due ? "text-clay-700" : "text-ink-soft"}`}
                        >
                          {formatShort(prospect.nextFollowUp)}
                          {due ? " · due" : ""}
                        </span>
                      ) : (
                        <span className="text-[13px] text-stone-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {adding && <ProspectFormModal onClose={() => setAdding(false)} />}
    </div>
  );
}
