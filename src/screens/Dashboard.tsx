// The Morning Dashboard — the only screen you open most days.
// Three columns: calls due today, meetings to schedule, and overdue,
// sorted by severity, scoped to your book (plus joint).

import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../lib/store";
import { useToast } from "../lib/toast";
import { useLogContact } from "../components/LogContactModal";
import { clientsById, openTasks, outreachKeys, sortByTierThenName } from "../lib/selectors";
import { dashboardBuckets } from "../engine/serviceEngine";
import { clientInScope, scopeFor, type Client, type Task } from "../types";
import { addDays, formatLong, formatShort, timeOfDayGreeting } from "../lib/dates";
import { AdvisorChip, DuePhrase, OutreachBadge, TierBadge } from "../components/badges";
import { EmptyState } from "../components/EmptyState";
import { PhoneLink } from "../components/PhoneLink";
import { SnoozeButton } from "../components/SnoozeButton";
import { Segmented } from "../components/ui";
import {
  AlertIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  PhoneIcon,
  RefreshIcon,
} from "../components/icons";

export function Dashboard() {
  const { data, currentUser, today, rebuildQueue, busy } = useApp();
  const toast = useToast();
  const [view, setView] = useState<"mine" | "firm">("mine");

  const derived = useMemo(() => {
    if (!data || !currentUser) return null;
    const byId = clientsById(data);
    const scope = scopeFor(currentUser);
    const useScope = scope !== "all" && view === "mine";

    const tasks = openTasks(data.tasks).filter((t) => {
      const client = byId.get(t.clientId);
      return client && (!useScope || clientInScope(client, scope));
    });

    const buckets = dashboardBuckets(tasks, today);
    return {
      byId,
      outreach: outreachKeys(data.dueDates),
      isAdvisor: scope !== "all",
      callsToday: sortByTierThenName(buckets.callsToday, byId),
      meetingsToday: sortByTierThenName(buckets.meetingsToday, byId),
      overdue: buckets.overdue,
      horizon: buckets.upcoming.filter((t) => t.dueDate <= addDays(today, 7)),
    };
  }, [data, currentUser, today, view]);

  if (!data || !currentUser || !derived) return null;

  const dueTodayCount = derived.callsToday.length + derived.meetingsToday.length;
  const summary =
    dueTodayCount === 0 && derived.overdue.length === 0
      ? "Nothing is waiting on you. Enjoy the quiet — or get ahead of the horizon."
      : `${dueTodayCount} ${dueTodayCount === 1 ? "touch" : "touches"} due today · ${derived.overdue.length} overdue ${derived.overdue.length === 1 ? "item" : "items"}.`;

  return (
    <div className="animate-rise space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium tracking-wide text-ink-soft uppercase">
            {formatLong(today)}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {timeOfDayGreeting()}, {currentUser.name.split(" ")[0]}.
          </h1>
          <p className="mt-1.5 text-sm text-ink-soft">{summary}</p>
        </div>
        <div className="flex items-center gap-2">
          {derived.isAdvisor && (
            <Segmented<"mine" | "firm">
              value={view}
              onChange={setView}
              options={[
                { value: "mine", label: "My book + joint" },
                { value: "firm", label: "Whole firm" },
              ]}
            />
          )}
          <button
            type="button"
            title="Rebuild the queue now (the 6am job, on demand)"
            disabled={busy}
            onClick={() => {
              void rebuildQueue().then(() => toast.push("Queue rebuilt for today.", "info"));
            }}
            className="cursor-pointer rounded-lg border border-stone-300 bg-white p-2 text-ink-soft shadow-sm transition-colors hover:bg-stone-50 hover:text-ink disabled:opacity-50"
          >
            <RefreshIcon className="size-4" />
          </button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Column
          title="Due today · Calls"
          accent="bg-sky-400"
          icon={<PhoneIcon className="size-4 text-sky-700" />}
          count={derived.callsToday.length}
          empty={
            <EmptyState
              icon={<PhoneIcon className="size-5" />}
              title="No calls due today"
              hint="The queue rebuilds every morning at six."
            />
          }
        >
          {derived.callsToday.map((t) => (
            <TaskCard key={t.id} task={t} client={derived.byId.get(t.clientId)!} today={today} isOutreach={derived.outreach.has(`${t.clientId}:${t.type}`)} />
          ))}
        </Column>

        <Column
          title="Due today · Meetings to schedule"
          accent="bg-pine-500"
          icon={<CalendarIcon className="size-4 text-pine-700" />}
          count={derived.meetingsToday.length}
          empty={
            <EmptyState
              icon={<CalendarIcon className="size-5" />}
              title="Nothing to schedule"
              hint="Meetings surface here the day they come due."
            />
          }
        >
          {derived.meetingsToday.map((t) => (
            <TaskCard key={t.id} task={t} client={derived.byId.get(t.clientId)!} today={today} isOutreach={derived.outreach.has(`${t.clientId}:${t.type}`)} />
          ))}
        </Column>

        <Column
          title="Overdue"
          accent="bg-clay-500"
          icon={<AlertIcon className="size-4 text-clay-600" />}
          count={derived.overdue.length}
          countTone="alert"
          empty={
            <EmptyState
              icon={<CheckCircleIcon className="size-5" />}
              title="Nothing overdue"
              hint="That's the whole point. Keep it this way."
            />
          }
        >
          {derived.overdue.map((t) => (
            <TaskCard key={t.id} task={t} client={derived.byId.get(t.clientId)!} today={today} isOutreach={derived.outreach.has(`${t.clientId}:${t.type}`)} />
          ))}
        </Column>
      </div>

      {derived.horizon.length > 0 && (
        <section className="card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ClockIcon className="size-4 text-stone-400" />
            On the horizon — next 7 days
          </h2>
          <ul className="mt-3 divide-y divide-stone-100">
            {derived.horizon.map((t) => {
              const client = derived.byId.get(t.clientId)!;
              return (
                <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="tnum w-14 shrink-0 text-xs font-semibold text-ink-soft">
                    {formatShort(t.dueDate)}
                  </span>
                  {t.type === "call" ? (
                    <PhoneIcon className="size-3.5 shrink-0 text-sky-600" />
                  ) : (
                    <CalendarIcon className="size-3.5 shrink-0 text-pine-600" />
                  )}
                  <Link
                    to={`/clients/${client.id}`}
                    className="min-w-0 flex-1 truncate font-medium hover:underline"
                  >
                    {client.householdName}
                  </Link>
                  <TierBadge tier={client.tier} />
                  <span className="hidden sm:inline-flex">
                    <AdvisorChip advisor={client.assignedAdvisor} />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

interface ColumnProps {
  title: string;
  accent: string;
  icon: ReactNode;
  count: number;
  countTone?: "default" | "alert";
  empty: ReactNode;
  children: ReactNode;
}

function Column({ title, accent, icon, count, countTone = "default", empty, children }: ColumnProps) {
  return (
    <section className="card overflow-hidden">
      <div className={`h-1 ${accent}`} />
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        {icon}
        <h2 className="flex-1 text-[13px] font-semibold tracking-wide text-ink">{title}</h2>
        <span
          className={`tnum rounded-full px-2 py-0.5 text-xs font-bold ${
            count > 0 && countTone === "alert"
              ? "bg-clay-100 text-clay-800"
              : "bg-stone-100 text-ink-soft"
          }`}
        >
          {count}
        </span>
      </div>
      <div className="space-y-2 px-3 pb-3">{count === 0 ? empty : children}</div>
    </section>
  );
}

function TaskCard({
  task,
  client,
  today,
  isOutreach,
}: {
  task: Task;
  client: Client;
  today: string;
  isOutreach: boolean;
}) {
  const { open } = useLogContact();
  return (
    <div className="group rounded-xl border border-stone-200 bg-white p-3 transition-all hover:-translate-y-px hover:border-stone-300 hover:shadow-lift">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <TierBadge tier={client.tier} />
            <Link
              to={`/clients/${client.id}`}
              className="truncate text-sm font-semibold hover:underline"
            >
              {client.householdName}
            </Link>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <AdvisorChip advisor={client.assignedAdvisor} />
            {isOutreach ? <OutreachBadge /> : <DuePhrase dueDate={task.dueDate} today={today} />}
          </div>
          {task.type === "call" && client.phone && (
            <div className="mt-1.5">
              <PhoneLink phone={client.phone} />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <SnoozeButton clientId={client.id} type={task.type} householdName={client.householdName} />
          <button
            type="button"
            onClick={() => open(client.id)}
            className="cursor-pointer rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-ink-soft shadow-sm transition-colors hover:border-pine-600 hover:bg-pine-700 hover:text-white"
          >
            Log
          </button>
        </div>
      </div>
    </div>
  );
}
