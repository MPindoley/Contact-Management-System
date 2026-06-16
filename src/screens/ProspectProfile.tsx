// Prospect detail — attempt history, status, follow-up, and convert-to-client.
// Convert is the only place prospects touch the client side, and only on an
// explicit click: it creates a fresh client (today's date, no back-history)
// so it can't retroactively change any existing graph.

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApp } from "../lib/store";
import { useToast } from "../lib/toast";
import {
  ADVISOR_LABELS,
  PROSPECT_EVENT_LABELS,
  PROSPECT_STATUSES,
  PROSPECT_STATUS_LABELS,
  type ProspectEventType,
  type ProspectStatus,
} from "../types";
import { formatMedium, formatMonth, formatShort, monthKey } from "../lib/dates";
import { AdvisorChip, ProspectStatusBadge } from "../components/badges";
import { PhoneLink } from "../components/PhoneLink";
import { ProspectFormModal } from "../components/ProspectFormModal";
import { LogProspectModal } from "../components/LogProspectModal";
import { EmptyState } from "../components/EmptyState";
import { Button, Select } from "../components/ui";
import {
  CalendarIcon,
  MailIcon,
  NoteIcon,
  PhoneIcon,
  PlusIcon,
  VoicemailIcon,
} from "../components/icons";

const EVENT_ICON: Record<ProspectEventType, typeof PhoneIcon> = {
  call: PhoneIcon,
  voicemail: VoicemailIcon,
  meeting: CalendarIcon,
  email: MailIcon,
  note: NoteIcon,
};

const EVENT_TONE: Record<ProspectEventType, string> = {
  call: "text-sky-700 bg-sky-50",
  voicemail: "text-violet-700 bg-violet-50",
  meeting: "text-pine-700 bg-pine-50",
  email: "text-amber-700 bg-amber-50",
  note: "text-stone-600 bg-stone-100",
};

export function ProspectProfile() {
  const { prospectId } = useParams<{ prospectId: string }>();
  const { data, updateProspect, deleteProspect, addClient, busy } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const prospect = data?.prospects.find((p) => p.id === prospectId) ?? null;

  const derived = useMemo(() => {
    if (!data || !prospect) return null;
    const events = data.prospectEvents
      .filter((e) => e.prospectId === prospect.id)
      .sort((a, b) => b.eventDate.localeCompare(a.eventDate) || b.createdAt.localeCompare(a.createdAt));

    const byMonth = new Map<string, typeof events>();
    for (const e of events) {
      const key = monthKey(e.eventDate);
      const bucket = byMonth.get(key);
      if (bucket) bucket.push(e);
      else byMonth.set(key, [e]);
    }
    return {
      events,
      months: [...byMonth.entries()],
      attempts: events.filter((e) => e.type !== "note").length,
      voicemails: events.filter((e) => e.type === "voicemail").length,
    };
  }, [data, prospect]);

  if (!data) return null;

  if (!prospect || !derived) {
    return (
      <div className="animate-rise">
        <EmptyState title="Prospect not found" hint="It may have been removed." />
        <p className="text-center">
          <Link to="/prospects" className="text-sm font-medium text-pine-700 hover:underline">
            ← Back to prospects
          </Link>
        </p>
      </div>
    );
  }

  async function convertToClient() {
    if (!prospect) return;
    try {
      const created = await addClient({
        householdName: prospect.name,
        assignedAdvisor: prospect.assignedAdvisor,
        tier: "B",
        phone: prospect.phone,
        redtailId: null,
        lastMeetingDate: null,
        lastCallDate: null,
      });
      await updateProspect(prospect.id, { status: "converted" });
      toast.push(`${prospect.name} converted to a client — set their tier and log the first touch.`);
      if (created) navigate(`/clients/${created.id}`);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't convert this prospect.", "error");
    }
  }

  return (
    <div className="animate-rise space-y-6">
      <header>
        <Link to="/prospects" className="text-[13px] font-medium text-ink-soft hover:text-ink hover:underline">
          ← Prospects
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{prospect.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ProspectStatusBadge status={prospect.status} />
              <AdvisorChip advisor={prospect.assignedAdvisor} />
              {prospect.phone && <PhoneLink phone={prospect.phone} className="text-[13px]" />}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="primary" onClick={() => setLogging(true)}>
              <PlusIcon className="size-4" />
              Log attempt
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="card p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">Attempt history</h2>
              <span className="text-xs text-stone-400">
                {derived.attempts} {derived.attempts === 1 ? "attempt" : "attempts"}
                {derived.voicemails > 0 ? ` · ${derived.voicemails} voicemail${derived.voicemails === 1 ? "" : "s"}` : ""}
              </span>
            </div>

            {derived.events.length === 0 ? (
              <EmptyState title="No attempts logged yet" hint="Log your first call or voicemail." />
            ) : (
              <div className="mt-4 space-y-5">
                {derived.months.map(([month, events]) => (
                  <div key={month}>
                    <p className="text-[11px] font-semibold tracking-wider text-stone-400 uppercase">
                      {formatMonth(`${month}-01`)}
                    </p>
                    <ul className="mt-2 space-y-px">
                      {events.map((e) => {
                        const Icon = EVENT_ICON[e.type];
                        return (
                          <li key={e.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-stone-50">
                            <span className="tnum w-12 shrink-0 pt-0.5 text-xs font-semibold text-ink-soft">
                              {formatShort(e.eventDate).replace(/, \d{4}$/, "")}
                            </span>
                            <span className={`flex size-6 shrink-0 items-center justify-center rounded-md ${EVENT_TONE[e.type]}`}>
                              <Icon className="size-3.5" />
                            </span>
                            <div className="min-w-0 flex-1 text-[13px] leading-snug">
                              <span className="font-medium">{PROSPECT_EVENT_LABELS[e.type]}</span>
                              {e.notes && <span className="text-ink-soft"> — {e.notes}</span>}
                              <p className="mt-0.5 text-xs text-stone-400">{ADVISOR_LABELS[e.advisor]}</p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="card p-5">
            <h2 className="text-sm font-semibold">Pipeline</h2>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">Status</span>
                <Select
                  value={prospect.status}
                  onChange={(e) => void updateProspect(prospect.id, { status: e.target.value as ProspectStatus })}
                >
                  {PROSPECT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PROSPECT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="text-[13px]">
                <span className="text-ink-soft">Next follow-up: </span>
                <span className="font-medium">
                  {prospect.nextFollowUp ? formatMedium(prospect.nextFollowUp) : "none set"}
                </span>
              </div>
            </div>
            {prospect.notes && (
              <p className="mt-4 border-t border-stone-100 pt-3 text-[13px] leading-relaxed text-ink-soft">
                {prospect.notes}
              </p>
            )}
          </section>

          {prospect.status !== "converted" && (
            <section className="card p-5">
              <h2 className="text-sm font-semibold">Ready to become a client?</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                Creates a client household from this prospect. Starts fresh today — your existing
                client graphs aren't touched.
              </p>
              <Button variant="primary" className="mt-3 w-full" onClick={() => void convertToClient()} disabled={busy}>
                Convert to client
              </Button>
            </section>
          )}

          <section className="card p-5">
            <h2 className="text-sm font-semibold">Remove</h2>
            {confirmingDelete ? (
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                  Keep
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => {
                    void deleteProspect(prospect.id).then(() => {
                      toast.push("Prospect removed.", "info");
                      navigate("/prospects");
                    });
                  }}
                >
                  Delete prospect
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="mt-1 cursor-pointer text-[13px] font-medium text-clay-700 underline-offset-2 hover:underline"
              >
                Delete this prospect
              </button>
            )}
          </section>
        </aside>
      </div>

      {editing && <ProspectFormModal prospect={prospect} onClose={() => setEditing(false)} />}
      {logging && <LogProspectModal prospect={prospect} onClose={() => setLogging(false)} />}
    </div>
  );
}
