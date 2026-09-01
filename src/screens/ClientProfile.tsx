// Client Profile — service history only, by design. Twelve months of
// touches, current due dates, health score, and the log button.

import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp } from "../lib/store";
import { useLogContact } from "../components/LogContactModal";
import { clientScore, modelFor } from "../engine/serviceEngine";
import { addDays, formatMedium, formatMonth, formatShort, monthKey } from "../lib/dates";
import { TOUCH_AUTHOR_LABELS, type ContactEvent, type TouchType } from "../types";
import { AdvisorChip, DuePhrase, HeldAwayBadge, TagChip, TierBadge, TypeChip } from "../components/badges";
import { ScoreRing } from "../components/ScoreRing";
import { ClientFormModal } from "../components/ClientFormModal";
import { EditContactModal } from "../components/EditContactModal";
import { EmptyState } from "../components/EmptyState";
import { FamilyPanel } from "../components/FamilyPanel";
import { PhoneLink } from "../components/PhoneLink";
import { Button } from "../components/ui";
import { CalendarIcon, ClockIcon, PhoneIcon, PlusIcon, VoicemailIcon } from "../components/icons";

export function ClientProfile() {
  const { clientId } = useParams<{ clientId: string }>();
  const { data, today } = useApp();
  const { open } = useLogContact();
  const [editing, setEditing] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ContactEvent | null>(null);

  const client = data?.clients.find((c) => c.id === clientId) ?? null;

  const derived = useMemo(() => {
    if (!data || !client) return null;
    const model = modelFor(data.serviceModels, client.tier);
    const dueDates = data.dueDates.filter((d) => d.clientId === client.id);
    const windowStart = addDays(today, -365);

    const events = data.contactEvents
      .filter((e) => e.clientId === client.id)
      .sort((a, b) => b.eventDate.localeCompare(a.eventDate) || b.createdAt.localeCompare(a.createdAt));
    const recent = events.filter((e) => e.eventDate > windowStart);

    const byMonth = new Map<string, typeof recent>();
    for (const e of recent) {
      const key = monthKey(e.eventDate);
      const bucket = byMonth.get(key);
      if (bucket) bucket.push(e);
      else byMonth.set(key, [e]);
    }

    // Voicemails since the last time they were actually reached (call/meeting).
    const lastMeaningful = events.find((e) => e.type === "call" || e.type === "meeting");
    const voicemailsSince = events.filter(
      (e) => e.type === "voicemail" && (!lastMeaningful || e.eventDate >= lastMeaningful.eventDate),
    ).length;

    return {
      model,
      meetingDue: dueDates.find((d) => d.type === "meeting") ?? null,
      callDue: dueDates.find((d) => d.type === "call") ?? null,
      score: clientScore(client, data.contactEvents, data.serviceModels, today),
      months: [...byMonth.entries()],
      recentCount: recent.length,
      olderCount: events.length - recent.length,
      voicemailsSince,
      eventsById: new Map(events.map((e) => [e.id, e])),
    };
  }, [data, client, today]);

  if (!data) return null;

  if (!client || !derived) {
    return (
      <div className="animate-rise">
        <EmptyState title="Household not found" hint="It may have been removed." />
        <p className="text-center">
          <Link to="/clients" className="text-sm font-medium text-pine-700 hover:underline">
            ← Back to clients
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="animate-rise space-y-6">
      <header>
        <Link to="/clients" className="text-[13px] font-medium text-ink-soft hover:text-ink hover:underline">
          ← Clients
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight">{client.householdName}</h1>
              {!client.active && (
                <span className="rounded-full bg-stone-200 px-2.5 py-1 text-[11px] font-semibold text-stone-600 uppercase">
                  Inactive
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <TierBadge tier={client.tier} label />
              <AdvisorChip advisor={client.assignedAdvisor} />
              {client.phone && <PhoneLink phone={client.phone} className="text-[13px]" />}
              {client.heldAway && <HeldAwayBadge note={client.heldAwayNote} />}
              <span className="text-xs text-stone-400">
                Meeting every {derived.model.meetingIntervalDays}d · call every{" "}
                {derived.model.callIntervalDays}d
                {client.redtailId ? ` · Redtail #${client.redtailId}` : ""}
              </span>
            </div>
            {client.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {client.tags.map((t) => (
                  <TagChip key={t} tag={t} />
                ))}
              </div>
            )}
            {client.heldAway && client.heldAwayNote && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[13px] font-medium text-emerald-900">
                💰 {client.heldAwayNote}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="primary" onClick={() => open(client.id)}>
              <PlusIcon className="size-4" />
              Log contact
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <DueCard
              clientId={client.id}
              householdName={client.householdName}
              type="meeting"
              due={derived.meetingDue?.dueDate ?? null}
              basedOn={derived.meetingDue?.computedFromEventId ?? null}
              snoozedUntil={derived.meetingDue?.snoozedUntil ?? null}
              eventsById={derived.eventsById}
              today={today}
              active={client.active}
            />
            <DueCard
              clientId={client.id}
              householdName={client.householdName}
              type="call"
              due={derived.callDue?.dueDate ?? null}
              basedOn={derived.callDue?.computedFromEventId ?? null}
              snoozedUntil={derived.callDue?.snoozedUntil ?? null}
              voicemailsSince={derived.voicemailsSince}
              eventsById={derived.eventsById}
              today={today}
              active={client.active}
            />
          </div>

          <section className="card p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">Contact history — last 12 months</h2>
              <span className="text-xs text-stone-400">
                {derived.recentCount} {derived.recentCount === 1 ? "touch" : "touches"}
              </span>
            </div>

            {derived.months.length === 0 ? (
              <EmptyState
                title="No touches in the last year"
                hint="Log the first one — the service clock starts there."
              />
            ) : (
              <div className="mt-4 space-y-5">
                {derived.months.map(([month, events]) => (
                  <div key={month}>
                    <p className="text-[11px] font-semibold tracking-wider text-stone-400 uppercase">
                      {formatMonth(`${month}-01`)}
                    </p>
                    <ul className="mt-2 space-y-px">
                      {events.map((e) => (
                        <li
                          key={e.id}
                          className="group flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-stone-50"
                        >
                          <span className="tnum w-12 shrink-0 pt-0.5 text-xs font-semibold text-ink-soft">
                            {formatShort(e.eventDate).replace(/, \d{4}$/, "")}
                          </span>
                          <TypeChip type={e.type} short />
                          <div className="min-w-0 flex-1 text-[13px] leading-snug">
                            {e.notes ? (
                              <p className="text-ink">{e.notes}</p>
                            ) : (
                              <p className="text-stone-400 italic">No notes</p>
                            )}
                            <p className="mt-0.5 text-xs text-stone-400">
                              {TOUCH_AUTHOR_LABELS[e.advisor]}
                              {e.durationMinutes ? ` · ${e.durationMinutes} min` : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setEditingEvent(e)}
                            className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-ink-soft opacity-0 transition-opacity hover:bg-stone-200/70 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            Edit
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {derived.olderCount > 0 && (
                  <p className="text-center text-xs text-stone-400">
                    + {derived.olderCount} older {derived.olderCount === 1 ? "touch" : "touches"} on
                    record
                  </p>
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <FamilyPanel client={client} />
          <section className="card flex flex-col items-center p-5">
            <h2 className="self-start text-sm font-semibold">Service health</h2>
            <div className="my-4">
              <ScoreRing value={derived.score.score} size={132} caption="trailing 12 months" />
            </div>
            <div className="w-full space-y-3">
              <BreakdownRow
                label="Meetings"
                completed={derived.score.completedMeetings}
                required={derived.score.requiredMeetings}
              />
              <BreakdownRow
                label="Calls"
                completed={derived.score.completedCalls}
                required={derived.score.requiredCalls}
              />
            </div>
            <p className="mt-4 text-xs leading-relaxed text-stone-400">
              Contacts completed on schedule ÷ contacts required for Tier {client.tier}. Admin
              touches don't count.
            </p>
          </section>

          <section className="card p-5 text-[13px] leading-relaxed text-ink-soft">
            <h2 className="text-sm font-semibold text-ink">About this profile</h2>
            <p className="mt-2">
              Service history only — no notes vault, no financials. That's what Redtail is for.
              Client since {formatMedium(client.createdAt.slice(0, 10))}.
            </p>
          </section>
        </aside>
      </div>

      <ClientFormModal open={editing} onClose={() => setEditing(false)} client={client} />
      {editingEvent && (
        <EditContactModal event={editingEvent} onClose={() => setEditingEvent(null)} />
      )}
    </div>
  );
}

function DueCard({
  clientId,
  householdName,
  type,
  due,
  basedOn,
  snoozedUntil,
  voicemailsSince = 0,
  eventsById,
  today,
  active,
}: {
  clientId: string;
  householdName: string;
  type: TouchType;
  due: string | null;
  basedOn: string | null;
  snoozedUntil: string | null;
  voicemailsSince?: number;
  eventsById: Map<string, { eventDate: string }>;
  today: string;
  active: boolean;
}) {
  const { snoozeTouch } = useApp();
  const Icon = type === "meeting" ? CalendarIcon : PhoneIcon;
  const tone = type === "meeting" ? "text-pine-700 bg-pine-50" : "text-sky-700 bg-sky-50";
  const source = basedOn ? eventsById.get(basedOn) : null;
  const isSnoozed = snoozedUntil !== null && snoozedUntil > today;
  const overdue = due !== null && due < today && active && !isSnoozed;

  return (
    <div className={`card p-4 ${overdue ? "border-clay-300 bg-clay-50/40" : ""}`}>
      <div className="flex items-center gap-2">
        <span className={`flex size-7 items-center justify-center rounded-lg ${tone}`}>
          <Icon className="size-4" />
        </span>
        <h3 className="text-[13px] font-semibold">
          Next {type === "meeting" ? "meeting" : "call"}
        </h3>
      </div>
      {due ? (
        <div className="mt-3">
          <p className="font-display text-2xl font-semibold tracking-tight">{formatMedium(due)}</p>
          <div className="mt-1 flex items-center gap-2">
            <DuePhrase dueDate={due} today={today} />
            {source ? (
              <span className="text-xs text-stone-400">
                · from the one on {formatShort(source.eventDate)}
              </span>
            ) : (
              <span className="text-xs font-medium text-gold-700">· first outreach</span>
            )}
          </div>
          {isSnoozed && (
            <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
                <ClockIcon className="size-3.5" />
                Snoozed until {formatMedium(snoozedUntil!)}
              </span>
              <button
                type="button"
                onClick={() => void snoozeTouch(clientId, type, null)}
                title={`Bring ${householdName} back to the queue now`}
                className="cursor-pointer text-xs font-medium text-amber-900 underline-offset-2 hover:underline"
              >
                Un-snooze
              </button>
            </div>
          )}
          {type === "call" && voicemailsSince > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-violet-700">
              <VoicemailIcon className="size-3.5" />
              {voicemailsSince} voicemail{voicemailsSince === 1 ? "" : "s"} left since you last
              reached them
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-stone-400">
          No history yet — log a {type} to start the clock.
        </p>
      )}
    </div>
  );
}

function BreakdownRow({ label, completed, required }: { label: string; completed: number; required: number }) {
  const capped = Math.min(completed, required);
  const pct = required === 0 ? 0 : Math.round((capped / required) * 100);
  const barColor = pct >= 100 ? "bg-pine-500" : pct >= 50 ? "bg-amber-400" : "bg-clay-500";
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="tnum text-ink-soft">
          {completed}/{required}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-200/70">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
