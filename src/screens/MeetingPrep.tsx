// Meeting prep sheet — everything you'd want in your head walking into a
// meeting, on one page. Built to be read on a phone in the parking lot or
// printed for the folder, so it is deliberately plain: no controls, no
// filters, nothing that needs a second tap.

import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp } from "../lib/store";
import { clientScore, modelFor } from "../engine/serviceEngine";
import { addDays, formatLong, formatMedium, formatShort } from "../lib/dates";
import { CLIENT_TAG_LABELS, FAMILY_ROLE_LABELS, TOUCH_AUTHOR_LABELS } from "../types";
import { AdvisorChip, DuePhrase, HeldAwayBadge, TierBadge, TypeChip } from "../components/badges";
import { EmptyState } from "../components/EmptyState";
import { PhoneLink } from "../components/PhoneLink";
import { Button } from "../components/ui";
import { CalendarIcon, PhoneIcon } from "../components/icons";

function money(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

export function MeetingPrep() {
  const { clientId } = useParams<{ clientId: string }>();
  const { data, today } = useApp();
  const client = data?.clients.find((c) => c.id === clientId) ?? null;

  const prep = useMemo(() => {
    if (!data || !client) return null;
    const events = data.contactEvents
      .filter((e) => e.clientId === client.id)
      .sort((a, b) => b.eventDate.localeCompare(a.eventDate) || b.createdAt.localeCompare(a.createdAt));
    const dueDates = data.dueDates.filter((d) => d.clientId === client.id);
    const family = client.familyId
      ? data.clients.filter((c) => c.familyId === client.familyId)
      : [];

    return {
      model: modelFor(data.serviceModels, client.tier),
      score: clientScore(client, data.contactEvents, data.serviceModels, today),
      meetingDue: dueDates.find((d) => d.type === "meeting") ?? null,
      callDue: dueDates.find((d) => d.type === "call") ?? null,
      // The last year of touches, most recent first — this is where the
      // "what did I promise last time" answer actually lives.
      recent: events.filter((e) => e.eventDate > addDays(today, -365)).slice(0, 12),
      lastMeeting: events.find((e) => e.type === "meeting") ?? null,
      family,
      familyName: data.families.find((f) => f.id === client.familyId)?.name ?? null,
      combined: family.reduce((sum, c) => sum + (c.revenue ?? 0), 0),
    };
  }, [data, client, today]);

  if (!data) return null;
  if (!client || !prep) {
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
    <div className="animate-rise mx-auto max-w-2xl space-y-5">
      <div className="no-print flex items-center justify-between gap-3">
        <Link
          to={`/clients/${client.id}`}
          className="text-[13px] font-medium text-ink-soft hover:text-ink hover:underline"
        >
          ← Back to profile
        </Link>
        <Button onClick={() => window.print()}>Print</Button>
      </div>

      {/* Who you're seeing */}
      <header className="card p-5">
        <p className="text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
          Meeting prep · {formatLong(today)}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{client.householdName}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TierBadge tier={client.tier} label />
          <AdvisorChip advisor={client.assignedAdvisor} />
          {client.phone && <PhoneLink phone={client.phone} className="text-[13px]" />}
          {client.heldAway && <HeldAwayBadge note={client.heldAwayNote} />}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-stone-400">Assets</dt>
            <dd className="tnum font-semibold">{money(client.revenue)}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-400">Service score</dt>
            <dd className="tnum font-semibold">
              {prep.score.score === null ? "—" : `${prep.score.score}%`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-stone-400">Cadence</dt>
            <dd className="text-[13px] font-medium">
              {prep.model.meetingIntervalDays}d / {prep.model.callIntervalDays}d
            </dd>
          </div>
          <div>
            <dt className="text-xs text-stone-400">Client since</dt>
            <dd className="text-[13px] font-medium">{formatMedium(client.createdAt.slice(0, 10))}</dd>
          </div>
        </dl>
        {client.heldAway && client.heldAwayNote && (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] font-medium text-emerald-900">
            💰 {client.heldAwayNote}
          </p>
        )}
      </header>

      {/* Booked meeting + what's owed */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold">Where this household stands</h2>
        {client.nextMeetingDate && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-pine-50 px-3 py-2 text-sm font-medium text-pine-900">
            <CalendarIcon className="size-4 shrink-0" />
            Booked for {formatMedium(client.nextMeetingDate)}
            {client.nextMeetingNote ? ` — ${client.nextMeetingNote}` : ""}
          </p>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-stone-200 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
              <CalendarIcon className="size-3.5" /> Next meeting
            </p>
            <p className="tnum mt-1 text-sm font-semibold">
              {prep.meetingDue ? formatMedium(prep.meetingDue.dueDate) : "—"}
            </p>
            {prep.meetingDue && (
              <DuePhrase dueDate={prep.meetingDue.dueDate} today={today} />
            )}
          </div>
          <div className="rounded-lg border border-stone-200 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
              <PhoneIcon className="size-3.5" /> Next call
            </p>
            <p className="tnum mt-1 text-sm font-semibold">
              {prep.callDue ? formatMedium(prep.callDue.dueDate) : "—"}
            </p>
            {prep.callDue && <DuePhrase dueDate={prep.callDue.dueDate} today={today} />}
          </div>
        </div>
      </section>

      {/* What to raise */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold">Bring these up</h2>
        {client.tags.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-soft">
            No opportunities flagged. Tag anything that comes up today from the client's profile.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {client.tags.map((t) => (
              <li key={t} className="flex items-center gap-2 text-sm">
                <span className="size-1.5 shrink-0 rounded-full bg-pine-600" />
                <span className="font-medium">{CLIENT_TAG_LABELS[t]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The household around them */}
      {prep.family.length > 1 && (
        <section className="card p-5">
          <h2 className="text-sm font-semibold">{prep.familyName ?? "Family"}</h2>
          <p className="tnum mt-1 text-[13px] text-ink-soft">
            Combined assets {money(prep.combined)}
          </p>
          <ul className="mt-3 divide-y divide-stone-100">
            {prep.family.map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-2 text-sm">
                <TierBadge tier={m.tier} />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {m.householdName}
                  {m.id === client.id && (
                    <span className="ml-1.5 text-xs font-normal text-stone-400">(this one)</span>
                  )}
                </span>
                {m.familyRole && (
                  <span className="text-xs text-ink-soft">{FAMILY_ROLE_LABELS[m.familyRole]}</span>
                )}
                <span className="tnum text-[13px] font-medium">{money(m.revenue)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* What you said you'd do */}
      <section className="card p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Since you last spoke</h2>
          {prep.lastMeeting && (
            <span className="text-xs text-stone-400">
              Last meeting {formatMedium(prep.lastMeeting.eventDate)}
            </span>
          )}
        </div>
        {prep.recent.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-soft">No touches on record in the last year.</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {prep.recent.map((e) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <span className="tnum w-14 shrink-0 pt-0.5 text-xs font-semibold text-ink-soft">
                  {formatShort(e.eventDate)}
                </span>
                <div className="min-w-0 flex-1">
                  <TypeChip type={e.type} short />
                  {e.notes ? (
                    <span className="ml-2">{e.notes}</span>
                  ) : (
                    <span className="ml-2 text-stone-400 italic">No notes</span>
                  )}
                  <span className="ml-2 text-xs text-stone-400">
                    {TOUCH_AUTHOR_LABELS[e.advisor]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
