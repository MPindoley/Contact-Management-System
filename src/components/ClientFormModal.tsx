// Manual client entry (Phase 1) and household editing. Adding a client asks
// for the real last-touch dates so the service clock starts from the truth,
// not from today.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AdvisorAssignment, Client, Tier } from "../types";
import { ADVISOR_LABELS, TIERS } from "../types";
import { useApp } from "../lib/store";
import { useToast } from "../lib/toast";
import { todayISO } from "../lib/dates";
import { annualRequired, modelFor } from "../engine/serviceEngine";
import { Button, Field, Input, Modal, Select, Spinner } from "./ui";

interface ClientFormModalProps {
  open: boolean;
  onClose: () => void;
  /** When present, the modal edits instead of creating. */
  client?: Client;
}

export function ClientFormModal({ open, onClose, client }: ClientFormModalProps) {
  if (!open) return null;
  return <ClientForm onClose={onClose} client={client} />;
}

function ClientForm({ onClose, client }: { onClose: () => void; client?: Client }) {
  const { data, addClient, updateClient, busy } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const editing = Boolean(client);

  const [name, setName] = useState(client?.householdName ?? "");
  const [advisor, setAdvisor] = useState<AdvisorAssignment>(client?.assignedAdvisor ?? "matt");
  const [tier, setTier] = useState<Tier>(client?.tier ?? "B");
  const [active, setActive] = useState(client?.active ?? true);
  const [redtailId, setRedtailId] = useState(client?.redtailId ?? "");
  const [lastMeeting, setLastMeeting] = useState(todayISO());
  const [lastCall, setLastCall] = useState(todayISO());

  const model = data ? modelFor(data.serviceModels, tier) : null;
  const cadence = model
    ? `Meeting every ${model.meetingIntervalDays}d · call every ${model.callIntervalDays}d · ≈${annualRequired(model).total} touches/yr`
    : "";

  async function submit() {
    if (!name.trim()) return;
    try {
      if (editing && client) {
        await updateClient(client.id, {
          householdName: name,
          assignedAdvisor: advisor,
          tier,
          active,
        });
        toast.push(
          tier !== client.tier
            ? `${name.trim()} updated — due dates reflowed for Tier ${tier}.`
            : `${name.trim()} updated.`,
        );
        onClose();
      } else {
        const created = await addClient({
          householdName: name,
          assignedAdvisor: advisor,
          tier,
          redtailId: redtailId || null,
          lastMeetingDate: lastMeeting || null,
          lastCallDate: lastCall || null,
        });
        toast.push(`${name.trim()} added — first due dates are on the queue.`);
        onClose();
        if (created) navigate(`/clients/${created.id}`);
      }
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Something went wrong saving the household.", "error");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? "Edit household" : "Add a household"}
      subtitle={
        editing
          ? undefined
          : "Phase 1: enter your top clients by hand and start logging touches today."
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Household name">
          <Input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Whitfield, Daniel & Mara"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Assigned advisor">
            <Select value={advisor} onChange={(e) => setAdvisor(e.target.value as AdvisorAssignment)}>
              {(Object.keys(ADVISOR_LABELS) as AdvisorAssignment[]).map((k) => (
                <option key={k} value={k}>
                  {ADVISOR_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Revenue tier" hint={cadence}>
            <Select value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  Tier {t}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {editing ? (
          <Field label="Status">
            <Select value={active ? "active" : "inactive"} onChange={(e) => setActive(e.target.value === "active")}>
              <option value="active">Active — on the service schedule</option>
              <option value="inactive">Inactive — paused, no tasks generated</option>
            </Select>
          </Field>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Last meeting" hint="Backdate to the real one.">
                <Input
                  type="date"
                  value={lastMeeting}
                  max={todayISO()}
                  onChange={(e) => setLastMeeting(e.target.value)}
                />
              </Field>
              <Field label="Last meaningful call" hint="Sets the call clock.">
                <Input
                  type="date"
                  value={lastCall}
                  max={todayISO()}
                  onChange={(e) => setLastCall(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Redtail ID (optional)" hint="For the Phase 4 sync.">
              <Input value={redtailId} onChange={(e) => setRedtailId(e.target.value)} placeholder="e.g. 48231" />
            </Field>
          </>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!name.trim() || busy}>
            {busy && <Spinner className="size-3.5 border-white/40 border-t-white" />}
            {editing ? "Save changes" : "Add household"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
