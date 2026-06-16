// Domain badges: tier, advisor, contact type, priority, score.

import type { AdvisorAssignment, ContactType, Priority, ProspectStatus, Tier } from "../types";
import { ADVISOR_LABELS, CONTACT_TYPE_LABELS, PROSPECT_STATUS_LABELS } from "../types";
import { scoreColor, type ScoreColor } from "../engine/serviceEngine";
import { dueLabel } from "../lib/dates";
import { CalendarIcon, ClipboardIcon, PhoneIcon, VoicemailIcon } from "./icons";

const TIER_STYLES: Record<Tier, string> = {
  A: "bg-gold-100 text-gold-800 ring-gold-300",
  B: "bg-sky-100 text-sky-800 ring-sky-300",
  C: "bg-stone-100 text-stone-600 ring-stone-300",
};

export function TierBadge({ tier, label = false }: { tier: Tier; label?: boolean }) {
  if (label) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold ring-1 ring-inset ${TIER_STYLES[tier]}`}
      >
        Tier {tier}
      </span>
    );
  }
  return (
    <span
      title={`Tier ${tier}`}
      className={`inline-flex size-5.5 shrink-0 items-center justify-center rounded-md text-xs font-bold ring-1 ring-inset ${TIER_STYLES[tier]}`}
    >
      {tier}
    </span>
  );
}

export function AdvisorChip({ advisor }: { advisor: AdvisorAssignment }) {
  const style =
    advisor === "joint"
      ? "bg-violet-100 text-violet-800"
      : "bg-stone-200/70 text-stone-700";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${style}`}>
      {ADVISOR_LABELS[advisor]}
    </span>
  );
}

const TYPE_META: Record<ContactType, { className: string; Icon: typeof PhoneIcon }> = {
  call: { className: "bg-sky-50 text-sky-800 ring-sky-200", Icon: PhoneIcon },
  meeting: { className: "bg-pine-50 text-pine-800 ring-pine-200", Icon: CalendarIcon },
  voicemail: { className: "bg-violet-50 text-violet-800 ring-violet-200", Icon: VoicemailIcon },
  admin: { className: "bg-stone-100 text-stone-600 ring-stone-200", Icon: ClipboardIcon },
};

export function TypeChip({ type, short = false }: { type: ContactType; short?: boolean }) {
  const { className, Icon } = TYPE_META[type];
  const text = short && type === "call" ? "Call" : CONTACT_TYPE_LABELS[type];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      <Icon className="size-3.5" />
      {text}
    </span>
  );
}

const PRIORITY_STYLES: Record<Priority, string> = {
  high: "bg-clay-100 text-clay-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-stone-200/70 text-stone-600",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function PriorityPill({ priority }: { priority: Priority }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORITY_STYLES[priority]}`}
    >
      {priority === "high" && <span className="size-1.5 rounded-full bg-clay-600" />}
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

const SCORE_PILL_STYLES: Record<ScoreColor, string> = {
  green: "bg-pine-100 text-pine-800",
  yellow: "bg-amber-100 text-amber-800",
  red: "bg-clay-100 text-clay-800",
};

export const SCORE_DOT_STYLES: Record<ScoreColor, string> = {
  green: "bg-pine-500",
  yellow: "bg-amber-400",
  red: "bg-clay-500",
};

export function ScorePill({ score }: { score: number }) {
  const color = scoreColor(score);
  return (
    <span
      className={`tnum inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${SCORE_PILL_STYLES[color]}`}
    >
      <span className={`size-1.5 rounded-full ${SCORE_DOT_STYLES[color]}`} />
      {score}%
    </span>
  );
}

const PROSPECT_STATUS_STYLES: Record<ProspectStatus, string> = {
  new: "bg-sky-100 text-sky-800",
  working: "bg-amber-100 text-amber-800",
  appointment: "bg-pine-100 text-pine-800",
  converted: "bg-violet-100 text-violet-800",
  lost: "bg-stone-200 text-stone-600",
};

export function ProspectStatusBadge({ status }: { status: ProspectStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${PROSPECT_STATUS_STYLES[status]}`}
    >
      {PROSPECT_STATUS_LABELS[status]}
    </span>
  );
}

/** Marks a first-touch with a never-contacted household. */
export function OutreachBadge() {
  return (
    <span
      title="First outreach — this household hasn't been contacted yet"
      className="inline-flex items-center gap-1 rounded-md bg-gold-100 px-1.5 py-0.5 text-[11px] font-semibold text-gold-800 ring-1 ring-gold-300 ring-inset"
    >
      ✦ First outreach
    </span>
  );
}

/** "due today" / "12 days overdue" / "due in 5 days", color-coded. */
export function DuePhrase({ dueDate, today }: { dueDate: string; today: string }) {
  const cls =
    dueDate < today
      ? "text-clay-700 font-semibold"
      : dueDate === today
        ? "text-pine-700 font-semibold"
        : "text-ink-soft";
  return <span className={`text-[13px] ${cls}`}>{dueLabel(dueDate, today)}</span>;
}
