// Plan initial outreach for never-contacted households: a paced backlog of
// first-touch calls, Tier A first, a few per weekday. The 14-day task horizon
// then keeps all but the imminent ones off the dashboard until their day.

import { useMemo, useState } from "react";
import { useApp } from "../lib/store";
import { useToast } from "../lib/toast";
import { planInitialOutreach, summarizeOutreach } from "../engine/outreach";
import { formatLong, formatMedium, todayISO } from "../lib/dates";
import { Button, Field, Input, Modal, Spinner } from "./ui";

const PACES = [
  { label: "Gentle", perWeekday: 2, hint: "2 a weekday" },
  { label: "Steady", perWeekday: 4, hint: "4 a weekday" },
  { label: "Brisk", perWeekday: 8, hint: "8 a weekday" },
];

export function PlanOutreachModal({ onClose }: { onClose: () => void }) {
  const { data, planOutreach, busy } = useApp();
  const toast = useToast();
  const [perWeekday, setPerWeekday] = useState(4);
  const [startDate, setStartDate] = useState(todayISO());

  const plan = useMemo(() => {
    if (!data) return [];
    return planInitialOutreach(data.clients, data.contactEvents, data.dueDates, {
      startDate,
      perWeekday,
    });
  }, [data, startDate, perWeekday]);

  const summary = useMemo(() => summarizeOutreach(plan), [plan]);

  async function submit() {
    if (plan.length === 0) return;
    try {
      await planOutreach(plan.map((p) => ({ clientId: p.clientId, dueDate: p.dueDate })));
      toast.push(
        `Outreach planned for ${plan.length} ${plan.length === 1 ? "household" : "households"} — they'll surface a few each day, Tier A first.`,
      );
      onClose();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't plan outreach.", "error");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Plan initial outreach"
      subtitle="Put every never-contacted household on your list — spaced out, not all at once."
    >
      {summary.count === 0 ? (
        <p className="rounded-lg bg-pine-50 px-4 py-6 text-center text-sm text-pine-800">
          Every active household has either been contacted or is already on the schedule. Nothing
          to plan.
        </p>
      ) : (
        <div className="space-y-5">
          <Field label="Pace" group>
            <div className="grid grid-cols-3 gap-2">
              {PACES.map((p) => (
                <button
                  key={p.perWeekday}
                  type="button"
                  onClick={() => setPerWeekday(p.perWeekday)}
                  className={`cursor-pointer rounded-lg border px-3 py-2.5 text-center transition-colors ${
                    perWeekday === p.perWeekday
                      ? "border-pine-600 bg-pine-50 ring-1 ring-pine-600"
                      : "border-stone-300 hover:bg-stone-50"
                  }`}
                >
                  <span className="block text-sm font-semibold">{p.label}</span>
                  <span className="block text-xs text-ink-soft">{p.hint}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Start date" hint="Weekends are skipped automatically.">
            <Input
              type="date"
              value={startDate}
              min={todayISO()}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-44"
            />
          </Field>

          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
            <p className="text-sm leading-relaxed text-ink">
              <span className="font-semibold">{summary.count}</span> never-contacted{" "}
              {summary.count === 1 ? "household" : "households"} — Tier A first — spread across{" "}
              <span className="font-semibold">{summary.weekdays}</span>{" "}
              {summary.weekdays === 1 ? "weekday" : "weekdays"}.
            </p>
            {summary.firstDate && summary.lastDate && (
              <p className="mt-1 text-[13px] text-ink-soft">
                {summary.firstDate === summary.lastDate ? (
                  <>All on {formatLong(summary.firstDate)}.</>
                ) : (
                  <>
                    First on {formatMedium(summary.firstDate)}, last on{" "}
                    {formatMedium(summary.lastDate)}.
                  </>
                )}
              </p>
            )}
            <p className="mt-2 text-xs text-stone-400">
              They appear on your dashboard a few at a time as each day comes — log a real call and
              that household switches to its normal service cadence.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void submit()} disabled={busy}>
              {busy && <Spinner className="size-3.5 border-white/40 border-t-white" />}
              Add {summary.count} to my queue
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
