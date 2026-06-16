// Add or edit a prospect. Prospects are a separate island — nothing here
// touches clients, the service engine, or any graph.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AdvisorAssignment, Prospect, ProspectStatus } from "../types";
import { ADVISOR_LABELS, PROSPECT_STATUSES, PROSPECT_STATUS_LABELS } from "../types";
import { useApp } from "../lib/store";
import { useToast } from "../lib/toast";
import { Button, Field, Input, Modal, Select, Spinner, Textarea } from "./ui";

export function ProspectFormModal({
  onClose,
  prospect,
}: {
  onClose: () => void;
  prospect?: Prospect;
}) {
  const { addProspect, updateProspect, busy } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const editing = Boolean(prospect);

  const [name, setName] = useState(prospect?.name ?? "");
  const [advisor, setAdvisor] = useState<AdvisorAssignment>(prospect?.assignedAdvisor ?? "matt");
  const [phone, setPhone] = useState(prospect?.phone ?? "");
  const [status, setStatus] = useState<ProspectStatus>(prospect?.status ?? "new");
  const [nextFollowUp, setNextFollowUp] = useState(prospect?.nextFollowUp ?? "");
  const [notes, setNotes] = useState(prospect?.notes ?? "");

  async function submit() {
    if (!name.trim()) return;
    try {
      if (editing && prospect) {
        await updateProspect(prospect.id, {
          name,
          assignedAdvisor: advisor,
          phone: phone.trim() || null,
          status,
          nextFollowUp: nextFollowUp || null,
          notes: notes.trim() || null,
        });
        toast.push(`${name.trim()} updated.`);
        onClose();
      } else {
        const created = await addProspect({
          name,
          assignedAdvisor: advisor,
          phone: phone.trim() || null,
          status,
          nextFollowUp: nextFollowUp || null,
          notes: notes.trim() || null,
        });
        toast.push(`${name.trim()} added to your prospects.`);
        onClose();
        if (created) navigate(`/prospects/${created.id}`);
      }
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't save the prospect.", "error");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? "Edit prospect" : "Add a prospect"}
      subtitle={editing ? undefined : "Someone you're calling who isn't a client yet."}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Name">
          <Input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sandoval, Marcus"
          />
        </Field>

        <Field label="Phone number" hint="Tap-to-call when it's time to reach out.">
          <Input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(419) 555-1234"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Advisor">
            <Select value={advisor} onChange={(e) => setAdvisor(e.target.value as AdvisorAssignment)}>
              {(Object.keys(ADVISOR_LABELS) as AdvisorAssignment[]).map((k) => (
                <option key={k} value={k}>
                  {ADVISOR_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as ProspectStatus)}>
              {PROSPECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROSPECT_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Next follow-up" hint="Optional — surfaces them on the prospect list when due.">
          <Input type="date" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} className="w-44" />
        </Field>

        <Field label="Notes (optional)">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Where they came from, what they're looking for…" />
        </Field>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!name.trim() || busy}>
            {busy && <Spinner className="size-3.5 border-white/40 border-t-white" />}
            {editing ? "Save changes" : "Add prospect"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
