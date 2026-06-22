// Fix or undo a logged touch. Editing the date/type reflows the client's due
// date through the same engine that logging does; deleting falls the clock
// back to the previous touch (or clears the due date entirely).

import { useState } from "react";
import type { ContactEvent, ContactType, TouchAuthor } from "../types";
import { TOUCH_AUTHORS, TOUCH_AUTHOR_LABELS, CONTACT_TYPE_LABELS } from "../types";
import { useApp } from "../lib/store";
import { useToast } from "../lib/toast";
import { Button, Field, Input, Modal, Segmented, Select, Spinner, Textarea } from "./ui";
import { CalendarIcon, ClipboardIcon, PhoneIcon } from "./icons";

export function EditContactModal({ event, onClose }: { event: ContactEvent; onClose: () => void }) {
  const { updateContactEvent, deleteContactEvent, today, busy } = useApp();
  const toast = useToast();

  const [type, setType] = useState<ContactType>(event.type);
  const [date, setDate] = useState(event.eventDate);
  const [advisor, setAdvisor] = useState<TouchAuthor>(event.advisor);
  const [duration, setDuration] = useState(event.durationMinutes?.toString() ?? "");
  const [notes, setNotes] = useState(event.notes ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function save() {
    try {
      await updateContactEvent(event.id, {
        type,
        eventDate: date,
        advisor,
        durationMinutes: duration.trim() === "" ? null : Math.max(0, Number(duration)),
        notes: notes.trim() || null,
      });
      toast.push(
        type === "admin"
          ? "Contact updated — service clock unchanged."
          : "Contact updated — due dates recomputed.",
      );
      onClose();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't update the contact.", "error");
    }
  }

  async function remove() {
    try {
      await deleteContactEvent(event.id);
      toast.push("Contact deleted — due dates fell back to the previous touch.", "info");
      onClose();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't delete the contact.", "error");
    }
  }

  return (
    <Modal open onClose={onClose} title="Edit contact" subtitle="Correct a mistake — the engine reflows from here.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Type" group>
          <Segmented<ContactType>
            value={type}
            onChange={setType}
            options={[
              { value: "meeting", label: "Meeting", icon: <CalendarIcon className="size-4" /> },
              { value: "call", label: "Meaningful Call", icon: <PhoneIcon className="size-4" /> },
              { value: "admin", label: "Admin", icon: <ClipboardIcon className="size-4" /> },
            ]}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date">
            <Input type="date" required value={date} max={today} onChange={(e) => setDate(e.target.value)} />
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

        <Field label="Duration (minutes)">
          <Input
            type="number"
            min={0}
            max={1440}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="Optional"
            className="w-28"
          />
        </Field>

        <Field label="Notes (optional)">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {confirmingDelete ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-clay-200 bg-clay-50 px-3 py-2.5">
            <span className="text-sm text-clay-900">
              Delete this {CONTACT_TYPE_LABELS[event.type].toLowerCase()}? This can't be undone.
            </span>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                Keep
              </Button>
              <Button size="sm" variant="danger" onClick={() => void remove()} disabled={busy}>
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button variant="ghost" onClick={() => setConfirmingDelete(true)} className="text-clay-700 hover:bg-clay-50">
              Delete
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={!date || busy}>
                {busy && <Spinner className="size-3.5 border-white/40 border-t-white" />}
                Save changes
              </Button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
