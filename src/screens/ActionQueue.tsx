// Action Queue — every pending item across the firm, sortable and
// filterable. Advisors land on their book + joint; the assistant sees all.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { useLogContact } from "../components/LogContactModal";
import { clientsById, openTasks } from "../lib/selectors";
import {
  clientInScope,
  scopeFor,
  ADVISOR_LABELS,
  type AdvisorAssignment,
  type Client,
  type Task,
  type Tier,
  type TouchType,
} from "../types";
import { formatShort } from "../lib/dates";
import { AdvisorChip, DuePhrase, PriorityPill, TierBadge, TypeChip } from "../components/badges";
import { EmptyState } from "../components/EmptyState";
import { SnoozeButton } from "../components/SnoozeButton";
import { Button, Input, Select } from "../components/ui";
import { CheckCircleIcon, SearchIcon } from "../components/icons";
import { CONTACT_TYPE_LABELS } from "../types";
import { downloadCsv } from "../lib/exportCsv";
import { dueLabel } from "../lib/dates";

type AdvisorFilter = "mine" | "all" | AdvisorAssignment;
type SortKey = "severity" | "due" | "household" | "tier" | "type";

const TIER_ORDER: Record<Tier, number> = { A: 0, B: 1, C: 2 };
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export function ActionQueue() {
  const { data, currentUser, today } = useApp();
  const { open } = useLogContact();
  const navigate = useNavigate();

  const isAdvisor = Boolean(currentUser?.advisorKey);
  const [advisorFilter, setAdvisorFilter] = useState<AdvisorFilter>(isAdvisor ? "mine" : "all");
  const [tierFilter, setTierFilter] = useState<"all" | Tier>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | TouchType>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "severity", dir: 1 });

  const rows = useMemo(() => {
    if (!data || !currentUser) return [];
    const byId = clientsById(data);
    const scope = scopeFor(currentUser);
    const q = search.trim().toLowerCase();

    const list = openTasks(data.tasks)
      .map((task) => ({ task, client: byId.get(task.clientId) }))
      .filter((r): r is { task: Task; client: Client } => Boolean(r.client))
      .filter(({ client }) => {
        if (advisorFilter === "mine") return clientInScope(client, scope);
        if (advisorFilter !== "all") return client.assignedAdvisor === advisorFilter;
        return true;
      })
      .filter(({ client }) => tierFilter === "all" || client.tier === tierFilter)
      .filter(({ task }) => typeFilter === "all" || task.type === typeFilter)
      .filter(({ client }) => !q || client.householdName.toLowerCase().includes(q));

    const cmp = (a: { task: Task; client: Client }, b: { task: Task; client: Client }): number => {
      switch (sort.key) {
        case "severity": {
          const pri = PRIORITY_ORDER[a.task.priority] - PRIORITY_ORDER[b.task.priority];
          if (pri !== 0) return pri;
          const od = b.task.daysOverdue - a.task.daysOverdue;
          if (od !== 0) return od;
          return TIER_ORDER[a.client.tier] - TIER_ORDER[b.client.tier];
        }
        case "due":
          return a.task.dueDate.localeCompare(b.task.dueDate);
        case "household":
          return a.client.householdName.localeCompare(b.client.householdName);
        case "tier":
          return TIER_ORDER[a.client.tier] - TIER_ORDER[b.client.tier];
        case "type":
          return a.task.type.localeCompare(b.task.type);
      }
    };

    return list.sort((a, b) => cmp(a, b) * sort.dir);
  }, [data, currentUser, advisorFilter, tierFilter, typeFilter, search, sort]);

  if (!data || !currentUser) return null;

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  const headerCell = (key: SortKey, label: string, extra = "") => (
    <th className={`px-4 py-2.5 text-left ${extra}`}>
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold tracking-wider text-ink-soft uppercase hover:text-ink"
      >
        {label}
        {sort.key === key && <span className="text-pine-600">{sort.dir === 1 ? "↓" : "↑"}</span>}
      </button>
    </th>
  );

  return (
    <div className="animate-rise space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Action Queue</h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            {rows.length} open {rows.length === 1 ? "item" : "items"} · tasks surface 14 days
            before they're due and escalate when they slip.
          </p>
        </div>
        <Button
          disabled={rows.length === 0}
          onClick={() =>
            downloadCsv(
              `action-queue-${today}.csv`,
              ["Priority", "Household", "Tier", "Type", "Advisor", "Due date", "Status"],
              rows.map(({ task, client }) => [
                task.priority,
                client.householdName,
                `Tier ${client.tier}`,
                CONTACT_TYPE_LABELS[task.type],
                ADVISOR_LABELS[client.assignedAdvisor],
                task.dueDate,
                dueLabel(task.dueDate, today),
              ]),
            )
          }
        >
          Export CSV
        </Button>
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
        <div className="w-44">
          <Select
            value={advisorFilter}
            onChange={(e) => setAdvisorFilter(e.target.value as AdvisorFilter)}
            aria-label="Filter by advisor"
          >
            {isAdvisor && <option value="mine">My book + joint</option>}
            <option value="all">All advisors</option>
            {(Object.keys(ADVISOR_LABELS) as AdvisorAssignment[]).map((k) => (
              <option key={k} value={k}>
                {ADVISOR_LABELS[k]}
              </option>
            ))}
          </Select>
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
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as "all" | TouchType)}
            aria-label="Filter by activity type"
          >
            <option value="all">Calls + meetings</option>
            <option value="call">Calls</option>
            <option value="meeting">Meetings</option>
          </Select>
        </div>
      </div>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            icon={<CheckCircleIcon className="size-5" />}
            title="Queue clear"
            hint="No open items match these filters."
          />
        ) : (
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50/60">
                {headerCell("severity", "Priority")}
                {headerCell("household", "Household")}
                {headerCell("tier", "Tier")}
                {headerCell("type", "Type")}
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                  Advisor
                </th>
                {headerCell("due", "Due")}
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ task, client }) => (
                <tr
                  key={task.id}
                  onClick={() => navigate(`/clients/${client.id}`)}
                  className="cursor-pointer border-b border-stone-100 transition-colors last:border-0 hover:bg-pine-50/50"
                >
                  <td className="px-4 py-3">
                    <PriorityPill priority={task.priority} />
                  </td>
                  <td className="px-4 py-3 font-semibold">{client.householdName}</td>
                  <td className="px-4 py-3">
                    <TierBadge tier={client.tier} />
                  </td>
                  <td className="px-4 py-3">
                    <TypeChip type={task.type} short />
                  </td>
                  <td className="px-4 py-3">
                    <AdvisorChip advisor={client.assignedAdvisor} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="leading-tight">
                      <span className="tnum block text-[13px] font-medium">
                        {formatShort(task.dueDate)}
                      </span>
                      <DuePhrase dueDate={task.dueDate} today={today} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <SnoozeButton
                        clientId={client.id}
                        type={task.type}
                        householdName={client.householdName}
                        compact
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          open(client.id);
                        }}
                        className="cursor-pointer rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-ink-soft shadow-sm transition-colors hover:border-pine-600 hover:bg-pine-700 hover:text-white"
                      >
                        Log
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
