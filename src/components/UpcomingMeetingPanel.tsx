// Book an upcoming meeting on a household.
//
// A booking is deliberately NOT a logged contact: it never credits the service
// score. It only parks the meeting touch until that day, so the morning board
// stops asking for something that's already on the calendar. When the day
// arrives the meeting surfaces again — and logging it clears the booking.

import { useState } from "react";
import { useApp } from "../lib/store";
import { useToast } from "../lib/toast";
import { formatMedium, todayISO } from "../lib/dates";
import type { Client } from "../types";
import { Button, Field, Input, Spinner, Textarea } from "./ui";
import { CalendarIcon } from "./icons";

export function UpcomingMeetingPanel({ client }: { client: Client }) {
  const { scheduleMeeting, clearScheduledMeeting, busy } = useApp();
  const toast = useToast();
  const today = todayISO();
  const booked = client.nextMeetingDate;

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(booked ?? "");
  const [note, setNote] = useState(client.nextMeetingNote ?? "");

  async function save() {
    if (!date) return;
    try {
      await scheduleMeeting(client.id, date, note.trim() || null);
      toast.push(
        `Meeting booked for ${formatMedium(date)} — off your list until then. Log it on the day.`,
      );
      setOpen(false);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't book that meeting.", "error");
    }
  }

  async function clear() {
    try {
      await clearScheduledMeeting(client.id);
      toast.push("Upcoming meeting removed — this household is back on the schedule.", "info");
      setOpen(false);
      setDate("");
      setNote("");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't remove that meeting.", "error");
    }
  }

  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <CalendarIcon className="size-4 text-pine-700" />
        Upcoming meeting
      </h2>

      {booked && !open ? (
        <>
          <p className="mt-3 font-display text-2xl font-semibold">{formatMedium(booked)}</p>
          {client.nextMeetingNote && (
            <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{client.nextMeetingNote}</p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-stone-400">
            {booked <= today
              ? "That's today — log it once you've met."
              : "Off your morning list until then. It doesn't count toward the service score until you log it."}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={() => setOpen(true)}>
              Reschedule
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void clear()}>
              Remove
            </Button>
          </div>
        </>
      ) : open ? (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Meeting date">
            <Input
              type="date"
              required
              autoFocus
              min={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Note (optional)">
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Annual review, bring the Roth analysis…"
            />
          </Field>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" disabled={!date || busy}>
              {busy && <Spinner className="size-3.5 border-white/40 border-t-white" />}
              {booked ? "Update" : "Book it"}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
            Got a date on the calendar? Put it here and this household drops off your morning list
            until then.
          </p>
          <Button size="sm" className="mt-3" onClick={() => setOpen(true)}>
            Schedule a meeting
          </Button>
        </>
      )}
    </section>
  );
}
