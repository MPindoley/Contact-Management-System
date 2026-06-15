// "Left a voicemail — remind me later." Defers a touch off the queue for a
// few days without falsely resetting the service clock. A small popover of
// quick options; the engine simply skips snoozed touches until the date.

import { useEffect, useRef, useState } from "react";
import type { TouchType } from "../types";
import { useApp } from "../lib/store";
import { useToast } from "../lib/toast";
import { addDays, formatMedium } from "../lib/dates";
import { ClockIcon } from "./icons";

const OPTIONS: Array<{ label: string; days: number }> = [
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
];

export function SnoozeButton({
  clientId,
  type,
  householdName,
  compact = false,
}: {
  clientId: string;
  type: TouchType;
  householdName: string;
  compact?: boolean;
}) {
  const { snoozeTouch, today, busy } = useApp();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function snooze(days: number) {
    const until = addDays(today, days);
    setOpen(false);
    try {
      await snoozeTouch(clientId, type, until);
      toast.push(`${householdName} snoozed until ${formatMedium(until)}.`, "info");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't snooze that.", "error");
    }
  }

  const trigger = compact
    ? "rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-ink"
    : "rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-ink-soft shadow-sm hover:border-stone-400 hover:bg-stone-50";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        title="Snooze — left a voicemail, remind me later"
        aria-label="Snooze this touch"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`inline-flex cursor-pointer items-center gap-1 transition-colors ${trigger}`}
      >
        <ClockIcon className="size-3.5" />
        {!compact && "Snooze"}
      </button>
      {open && (
        <div
          className="animate-rise absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lift"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-3 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-stone-400 uppercase">
            Remind me in
          </p>
          {OPTIONS.map((o) => (
            <button
              key={o.days}
              type="button"
              disabled={busy}
              onClick={() => void snooze(o.days)}
              className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-pine-50 disabled:opacity-50"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
