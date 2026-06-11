// Firm Service Report — the read-only Monday-standup page. Scores by
// advisor and tier, overdue counts, monthly pace vs target.

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../lib/store";
import {
  annualRequired,
  modelFor,
  monthlyProgress,
  rollupScore,
  scoreColor,
} from "../engine/serviceEngine";
import { clientsById, openTasks } from "../lib/selectors";
import { ADVISOR_LABELS, TIERS, type AdvisorAssignment, type Client, type Task } from "../types";
import { formatLong, formatMonth, monthKey } from "../lib/dates";
import { ScoreRing } from "../components/ScoreRing";
import { SCORE_DOT_STYLES, AdvisorChip, TierBadge, TypeChip } from "../components/badges";
import { EmptyState } from "../components/EmptyState";
import { CheckCircleIcon } from "../components/icons";

const ADVISOR_BUCKETS: AdvisorAssignment[] = ["matt", "advisor_b", "joint"];

export function FirmReport() {
  const { data, today } = useApp();

  const report = useMemo(() => {
    if (!data) return null;
    const byId = clientsById(data);
    const active = data.clients.filter((c) => c.active);
    const open = openTasks(data.tasks).filter((t) => byId.get(t.clientId)?.active);
    const overdueTasks = open
      .filter((t) => t.dueDate < today)
      .sort((a, b) => b.daysOverdue - a.daysOverdue);

    const overdueClientIds = new Set(overdueTasks.map((t) => t.clientId));
    const overdueCountFor = (clients: Client[]) =>
      clients.filter((c) => overdueClientIds.has(c.id)).length;

    const advisorRows = ADVISOR_BUCKETS.map((key) => {
      const clients = active.filter((c) => c.assignedAdvisor === key);
      return {
        key,
        clients,
        score: rollupScore(clients, data.contactEvents, data.serviceModels, today),
        overdue: overdueCountFor(clients),
      };
    });

    const tierRows = TIERS.map((tier) => {
      const clients = active.filter((c) => c.tier === tier);
      const model = modelFor(data.serviceModels, tier);
      return {
        tier,
        model,
        required: annualRequired(model),
        clients,
        score: rollupScore(clients, data.contactEvents, data.serviceModels, today),
        overdue: overdueCountFor(clients),
      };
    });

    const month = monthKey(today);
    const monthEvents = data.contactEvents.filter(
      (e) => e.type !== "admin" && monthKey(e.eventDate) === month && e.eventDate <= today,
    );

    return {
      byId,
      firmScore: rollupScore(active, data.contactEvents, data.serviceModels, today),
      activeCount: active.length,
      advisorRows,
      tierRows,
      overdueTasks,
      overdueClients: overdueClientIds.size,
      pace: monthlyProgress(data.clients, data.serviceModels, data.contactEvents, today),
      monthMeetings: monthEvents.filter((e) => e.type === "meeting").length,
      monthCalls: monthEvents.filter((e) => e.type === "call").length,
    };
  }, [data, today]);

  if (!data || !report) return null;

  return (
    <div className="animate-rise space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Firm Service Report</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          As of {formatLong(today)} · score = contacts completed on schedule ÷ contacts required,
          trailing 12 months.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-4">
        <div className="card flex flex-col items-center justify-center p-6">
          <ScoreRing value={report.firmScore?.score ?? null} size={150} caption="Firm service score" />
          <p className="tnum mt-3 text-xs text-stone-400">
            {report.activeCount} active households
            {report.firmScore &&
              ` · ${report.firmScore.completedMeetings + report.firmScore.completedCalls}/${
                report.firmScore.requiredMeetings + report.firmScore.requiredCalls
              } touches credited`}
          </p>
        </div>

        {report.advisorRows.map(({ key, clients, score, overdue }) => (
          <div key={key} className="card flex flex-col items-center p-5">
            <div className="mb-3 flex w-full items-center justify-between">
              <span className="text-sm font-semibold">{ADVISOR_LABELS[key]}</span>
              {score && (
                <span className={`size-2.5 rounded-full ${SCORE_DOT_STYLES[scoreColor(score.score)]}`} />
              )}
            </div>
            <ScoreRing value={score?.score ?? null} size={104} strokeWidth={9} />
            <dl className="mt-4 w-full space-y-1 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-ink-soft">Households</dt>
                <dd className="tnum font-medium">{clients.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">With overdue items</dt>
                <dd className={`tnum font-medium ${overdue > 0 ? "text-clay-700" : ""}`}>{overdue}</dd>
              </div>
            </dl>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {report.tierRows.map(({ tier, model, required, clients, score, overdue }) => (
          <div key={tier} className="card p-5">
            <div className="flex items-center justify-between">
              <TierBadge tier={tier} label />
              <span className="tnum text-xs text-stone-400">
                {clients.length} {clients.length === 1 ? "household" : "households"}
              </span>
            </div>
            <p className="mt-2 text-xs text-stone-400">
              Meeting every {model.meetingIntervalDays}d · call every {model.callIntervalDays}d ·{" "}
              {required.total} touches/yr each
            </p>
            <div className="mt-4 flex items-end justify-between">
              <span className="font-display text-3xl font-semibold">
                {score ? `${score.score}%` : "—"}
              </span>
              <span className={`text-[13px] font-medium ${overdue > 0 ? "text-clay-700" : "text-ink-soft"}`}>
                {overdue} overdue
              </span>
            </div>
            <ScoreBar score={score?.score ?? null} />
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="text-sm font-semibold">This month — {formatMonth(today)}</h2>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="font-display text-4xl font-semibold">{report.pace.completed}</span>
            <span className="text-sm text-ink-soft">of ~{report.pace.target} contacts on pace</span>
          </div>
          <PaceBar completed={report.pace.completed} target={report.pace.target} />
          <p className="mt-3 text-[13px] text-ink-soft">
            {report.monthMeetings} {report.monthMeetings === 1 ? "meeting" : "meetings"} ·{" "}
            {report.monthCalls} meaningful {report.monthCalls === 1 ? "call" : "calls"}
          </p>
          <p className="mt-1 text-xs text-stone-400">
            Target = the book's annual requirement ÷ 12, so a quiet month shows up before a quiet
            quarter does.
          </p>
        </div>

        <div className="card p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Most overdue</h2>
            <span className="tnum text-xs text-stone-400">
              {report.overdueClients} {report.overdueClients === 1 ? "household" : "households"} affected
            </span>
          </div>
          {report.overdueTasks.length === 0 ? (
            <EmptyState
              icon={<CheckCircleIcon className="size-5" />}
              title="Nothing overdue across the firm"
              hint="Monday standup just got shorter."
            />
          ) : (
            <ul className="mt-3 divide-y divide-stone-100">
              {report.overdueTasks.slice(0, 6).map((t: Task) => {
                const client = report.byId.get(t.clientId)!;
                return (
                  <li key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <TierBadge tier={client.tier} />
                    <Link
                      to={`/clients/${client.id}`}
                      className="min-w-0 flex-1 truncate font-medium hover:underline"
                    >
                      {client.householdName}
                    </Link>
                    <TypeChip type={t.type} short />
                    <span className="hidden sm:inline-flex">
                      <AdvisorChip advisor={client.assignedAdvisor} />
                    </span>
                    <span className="tnum w-14 text-right text-[13px] font-semibold text-clay-700">
                      {t.daysOverdue}d
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function ScoreBar({ score }: { score: number | null }) {
  const pct = score ?? 0;
  const color =
    score === null
      ? "bg-stone-300"
      : scoreColor(score) === "green"
        ? "bg-pine-500"
        : scoreColor(score) === "yellow"
          ? "bg-amber-400"
          : "bg-clay-500";
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-200/70">
      <div
        className={`h-full rounded-full transition-[width] duration-700 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function PaceBar({ completed, target }: { completed: number; target: number }) {
  const pct = target === 0 ? 0 : Math.min(100, Math.round((completed / target) * 100));
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-200/70">
      <div
        className="h-full rounded-full bg-pine-500 transition-[width] duration-700"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
