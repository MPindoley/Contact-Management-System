// Log an attempt against a prospect: call, voicemail, meeting, email, or note.
// Voicemails are the whole point — keep calling, keep tracking.

import { useState } from "react";
import type { Prospect, ProspectEventType, TouchAuthor } from "../types";
import { TOUCH_AUTHORS, TOUCH_AUTHOR_LABELS, PROSPECT_EVENT_LABELS, authorForUser } from "../types";
import { useApp } from "../lib/store";
import { useToast } from "../lib/toast";
import { addDays, todayISO } from "../lib/dates";
import { Button, Field, Input, Modal, Segmented, Select, Spinner, Textarea } from "./ui";
import { CalendarIcon, MailIcon, NoteIcon, PhoneIcon, VoicemailIcon } from "./icons";

const TYPE_OPTIONS: Array<{ value: ProspectEventType; label: string; icon: React.ReactNode }> = [
  { value: "call", label: "Call", icon: <PhoneIcon className="size-4" /> },
  { value: "voicemail", label: "Voicemail", icon: <VoicemailIcon className="size-4" /> },
  { value: "meeting", label: "Meeting", icon: <CalendarIcon className="size-4" /> },
  { value: "email", label: "Email", icon: <MailIcon className="size-4" /> },
  { value: "note", label: "Note", icon: <NoteIcon className="size-4" /> },
];

const FOLLOW_UP_OPTIONS = [
  { label: "Tomorrow", days: 1 },
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
  { label: "No date", days: -1 },
];

export function LogProspectModal({ prospect, onClose }: { prospect: Prospect; onClose: () => void }) {
  const { logProspectContact, currentUser, busy } = useApp();
  const toast = useToast();

  const [type, setType] = useState<ProspectEventType>("call");
  const [date, setDate] = useState(todayISO());
  const [advisor, setAdvisor] = useState<TouchAuthor>(
    currentUser?.role === "assistant"
      ? "assistant" // the assistant logs as herself by default
      : prospect.assignedAdvisor !== "joint"
        ? prospect.assignedAdvisor
        : authorForUser(currentUser),
  );
  const [notes, setNotes] = useState("");
  const [followUpDays, setFollowUpDays] = useState(3);

  async function submit() {
    try {
      const nextFollowUp = followUpDays >= 0 ? addDays(todayISO(), followUpDays) : null;
      await logProspectContact({
        prospectId: prospect.id,
        advisor,
        type,
        eventDate: date,
        notes: notes.trim() || null,
        nextFollowUp,
      });
      toast.push(
        nextFollowUp
          ? `${PROSPECT_EVENT_LABELS[type]} logged — follow up ${nextFollowUp}.`
          : `${PROSPECT_EVENT_LABELS[type]} logged for ${prospect.name}.`,
      );
      onClose();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't log that.", "error");
    }
  }

  return (
    <Modal open onClose={onClose} title="Log an attempt" subtitle={prospect.name}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Type" group>
          <Segmented<ProspectEventType> value={type} onChange={setType} options={TYPE_OPTIONS} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date">
            <Input type="date" required value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Logged by">
            <Select value={advisor} onChange={(e) => setAdvisor(e.target.value as TouchAuthor)}>
              {TOUCH_AUTHORS.map((k) => (
                <option key={k} value={k}>
                  {TOUCH_AUTHOR_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Follow up again" group>
          <div className="flex flex-wrap gap-1.5">
            {FOLLOW_UP_OPTIONS.map((o) => (
              <button
                key={o.days}
                type="button"
                onClick={() => setFollowUpDays(o.days)}
                className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  followUpDays === o.days
                    ? "bg-pine-700 text-white"
                    : "bg-stone-100 text-ink-soft hover:bg-stone-200"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Notes (optional)">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened on this attempt?" />
        </Field>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy && <Spinner className="size-3.5 border-white/40 border-t-white" />}
            Log it
          </Button>
        </div>
      </form>
    </Modal>
  );
}
