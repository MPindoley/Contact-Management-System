// Service Models — the rules per tier. Editable, not hardcoded: change an
// interval and every due date and task in the book reflows.

import { useState } from "react";
import { useApp } from "../lib/store";
import { useToast } from "../lib/toast";
import { annualRequired } from "../engine/serviceEngine";
import type { ServiceModel, Tier } from "../types";
import { TierBadge } from "../components/badges";
import { Button, Field, Input, Spinner } from "../components/ui";

const TIER_BLURBS: Record<Tier, string> = {
  A: "Your top households — the relationships that pay for everything else.",
  B: "The steady core of the book.",
  C: "Lighter-touch relationships, kept warm.",
};

export function ServiceModels() {
  const { data, currentUser } = useApp();
  if (!data) return null;

  return (
    <div className="animate-rise space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Service Models</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-ink-soft">
          The cadence each tier is owed. Saving a change recomputes every due date and rebuilds
          the queue from the same last-contact dates — the whole book reflows instantly.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
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

  const meetingNum = Number(meeting);
  const callNum = Number(call);
  const valid =
    Number.isInteger(meetingNum) && meetingNum >= 1 && meetingNum <= 1095 &&
    Number.isInteger(callNum) && callNum >= 1 && callNum <= 1095;
  const dirty = valid && (meetingNum !== model.meetingIntervalDays || callNum !== model.callIntervalDays);

  const preview = valid
    ? annualRequired({ ...model, meetingIntervalDays: meetingNum, callIntervalDays: callNum })
    : annualRequired(model);

  async function save() {
    try {
      await updateServiceModel({
        tier: model.tier,
        meetingIntervalDays: meetingNum,
        callIntervalDays: callNum,
      });
      toast.push(`Tier ${model.tier} cadence updated — due dates reflowed across the book.`);
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
      <p className="mt-2 min-h-9 text-xs leading-relaxed text-stone-400">{TIER_BLURBS[model.tier]}</p>

      <div className="mt-4 space-y-3">
        <Field label="Meeting every (days)">
          <Input
            type="number"
            min={1}
            max={1095}
            value={meeting}
            onChange={(e) => setMeeting(e.target.value)}
          />
        </Field>
        <Field label="Meaningful call every (days)">
          <Input
            type="number"
            min={1}
            max={1095}
            value={call}
            onChange={(e) => setCall(e.target.value)}
          />
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
