// Service Models — the rules AND the criteria per tier. Everything here is
// editable: change a cadence and the whole book's due dates reflow; change a
// tier's revenue cutoff or description and it's reflected in the CSV import
// and everywhere the criteria are shown.

import { useState } from "react";
import { useApp } from "../lib/store";
import { useToast } from "../lib/toast";
import { annualRequired } from "../engine/serviceEngine";
import type { ServiceModel } from "../types";
import { TierBadge } from "../components/badges";
import { Button, Field, Input, Spinner, Textarea } from "../components/ui";

function formatMoney(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

export function ServiceModels() {
  const { data, currentUser } = useApp();
  if (!data) return null;

  return (
    <div className="animate-rise space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Tiers & service models</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-ink-soft">
          What defines each tier and the cadence it's owed — both editable as your book grows.
          Tiers run S (your very top) → A → B → C. Saving a cadence change reflows every due date
          from the same last-contact dates; the revenue cutoffs feed the CSV importer's auto-tiering.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.serviceModels.map((model) => (
          <ModelCard key={model.tier} model={model} />
        ))}
      </div>

      <section className="card max-w-2xl p-5">
        <h2 className="text-sm font-semibold">The people</h2>
        <ul className="mt-3 divide-y divide-stone-100">
          {data.users.map((u) => (
            <li key={u.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="flex size-8 items-center justify-center rounded-full bg-pine-800 text-xs font-semibold text-pine-100">
                {u.name
                  .split(/\s+/)
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
              <span className="flex-1 font-medium">
                {u.name}
                {currentUser?.id === u.id && (
                  <span className="ml-2 text-xs font-normal text-stone-400">(you)</span>
                )}
              </span>
              <span className="text-[13px] text-ink-soft">
                {u.role === "advisor" ? "Advisor — sees their book + joint" : "Assistant — sees everything"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ModelCard({ model }: { model: ServiceModel }) {
  const { updateServiceModel, busy } = useApp();
  const toast = useToast();
  const [meeting, setMeeting] = useState(String(model.meetingIntervalDays));
  const [call, setCall] = useState(String(model.callIntervalDays));
  const [minRevenue, setMinRevenue] = useState(model.minRevenue === null ? "" : String(model.minRevenue));
  const [description, setDescription] = useState(model.description ?? "");

  const meetingNum = Number(meeting);
  const callNum = Number(call);
  const revStr = minRevenue.replace(/[$,\s]/g, "");
  const revNum = revStr === "" ? null : Number(revStr);
  const intervalsValid =
    Number.isInteger(meetingNum) && meetingNum >= 1 && meetingNum <= 1095 &&
    Number.isInteger(callNum) && callNum >= 1 && callNum <= 1095;
  const revValid = revNum === null || (Number.isFinite(revNum) && revNum >= 0);
  const valid = intervalsValid && revValid;

  const dirty =
    valid &&
    (meetingNum !== model.meetingIntervalDays ||
      callNum !== model.callIntervalDays ||
      revNum !== model.minRevenue ||
      (description.trim() || null) !== (model.description ?? null));

  const cadenceChanged =
    meetingNum !== model.meetingIntervalDays || callNum !== model.callIntervalDays;

  const preview = intervalsValid
    ? annualRequired({ ...model, meetingIntervalDays: meetingNum, callIntervalDays: callNum })
    : annualRequired(model);

  async function save() {
    try {
      await updateServiceModel({
        tier: model.tier,
        meetingIntervalDays: meetingNum,
        callIntervalDays: callNum,
        minRevenue: revNum,
        description: description.trim() || null,
      });
      toast.push(
        cadenceChanged
          ? `Tier ${model.tier} saved — due dates reflowed across the book.`
          : `Tier ${model.tier} criteria saved.`,
      );
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't save the service model.", "error");
    }
  }

  return (
    <form
      className="card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) void save();
      }}
    >
      <div className="flex items-center justify-between">
        <TierBadge tier={model.tier} label />
        <span className="tnum rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-ink-soft">
          ≈ {preview.total} touches/yr
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <Field label="Criteria" hint="What earns a household this tier.">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Top relationships, centers of influence…"
          />
        </Field>
        <Field label="Revenue / AUM at or above" hint="Used to auto-assign tiers on CSV import. Blank = no floor.">
          <div className="flex items-center gap-2">
            <Input
              value={minRevenue}
              onChange={(e) => setMinRevenue(e.target.value)}
              placeholder="e.g. 100000"
            />
            <span className="tnum shrink-0 text-xs font-medium text-ink-soft">
              {formatMoney(revNum)}
            </span>
          </div>
        </Field>
        <Field label="Meeting every (days)">
          <Input type="number" min={1} max={1095} value={meeting} onChange={(e) => setMeeting(e.target.value)} />
        </Field>
        <Field label="Meaningful call every (days)">
          <Input type="number" min={1} max={1095} value={call} onChange={(e) => setCall(e.target.value)} />
        </Field>
      </div>

      <p className="tnum mt-3 text-xs text-stone-400">
        = {preview.meetings} {preview.meetings === 1 ? "meeting" : "meetings"} + {preview.calls}{" "}
        {preview.calls === 1 ? "call" : "calls"} per household per year
      </p>

      <Button variant="primary" type="submit" disabled={!dirty || busy} className="mt-4 w-full">
        {busy && <Spinner className="size-3.5 border-white/40 border-t-white" />}
        Save Tier {model.tier}
      </Button>
    </form>
  );
}
