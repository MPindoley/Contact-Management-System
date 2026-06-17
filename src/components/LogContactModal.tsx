// The one interaction that drives the whole system. Available from every
// screen via useLogContact().open(clientId?) — logs a touch, settles the
// matching task, and reports the freshly computed next due date back.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AdvisorKey, ContactType } from "../types";
import { ADVISOR_LABELS, ADVISOR_KEYS, CONTACT_TYPE_LABELS } from "../types";
import { useApp } from "../lib/store";
import { useToast } from "../lib/toast";
import { addDays, formatMedium, todayISO } from "../lib/dates";
import { Button, Field, Input, Modal, Segmented, Select, Spinner, Textarea } from "./ui";
import { TierBadge, AdvisorChip, HeldAwayBadge } from "./badges";
import { CalendarIcon, ClipboardIcon, PhoneIcon, SearchIcon, VoicemailIcon } from "./icons";

interface LogContactContextValue {
  open: (clientId?: string) => void;
}

const LogContactContext = createContext<LogContactContextValue | null>(null);

export function useLogContact(): LogContactContextValue {
  const ctx = useContext(LogContactContext);
  if (!ctx) throw new Error("useLogContact must be used inside <LogContactProvider>");
  return ctx;
}

export function LogContactProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; clientId: string | null }>({
    open: false,
    clientId: null,
  });

  const open = useCallback((clientId?: string) => {
    setState({ open: true, clientId: clientId ?? null });
  }, []);

  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);

  // Press "l" anywhere (outside an input) to log a contact.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const value = useMemo(() => ({ open }), [open]);

  return (
    <LogContactContext.Provider value={value}>
      {children}
      {state.open && <LogContactForm initialClientId={state.clientId} onClose={close} />}
    </LogContactContext.Provider>
  );
}

const DURATION_CHIPS: Record<ContactType, number[]> = {
  meeting: [30, 45, 60, 90],
  call: [10, 15, 20, 30],
  voicemail: [1, 2],
  admin: [5, 10, 15],
};

const TRY_AGAIN_OPTIONS = [
  { label: "Tomorrow", days: 1 },
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
  { label: "Don't snooze", days: 0 },
];

function LogContactForm({ initialClientId, onClose }: { initialClientId: string | null; onClose: () => void }) {
  const { data, currentUser, logContact, snoozeTouch, busy, today } = useApp();
  const toast = useToast();

  const clients = useMemo(
    () =>
      (data?.clients ?? [])
        .filter((c) => c.active)
        .sort((a, b) => a.householdName.localeCompare(b.householdName)),
    [data],
  );

  const [clientId, setClientId] = useState<string | null>(initialClientId);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<ContactType>("call");
  const [date, setDate] = useState(todayISO());
  const [duration, setDuration] = useState<string>("");
  const [advisor, setAdvisor] = useState<AdvisorKey>(currentUser?.advisorKey ?? "matt");
  const [notes, setNotes] = useState("");
  // After leaving a voicemail: snooze the call this many days (0 = don't snooze).
  const [tryAgainDays, setTryAgainDays] = useState(3);

  const selected = clients.find((c) => c.id === clientId) ?? null;

  // Default the advisor to whoever owns the household (joint → current user).
  useEffect(() => {
    if (!selected) return;
    if (selected.assignedAdvisor !== "joint") {
      setAdvisor(selected.assignedAdvisor);
    } else if (currentUser?.advisorKey) {
      setAdvisor(currentUser.advisorKey);
    }
  }, [selected, currentUser]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? clients.filter((c) => c.householdName.toLowerCase().includes(q)) : clients;
    return pool.slice(0, 8);
  }, [clients, query]);

  async function submit() {
    if (!selected) return;
    try {
      const dueDates = await logContact({
        clientId: selected.id,
        advisor,
        type,
        eventDate: date,
        durationMinutes: duration.trim() === "" ? null : Math.max(0, Number(duration)),
        notes: notes.trim() || null,
      });
      if (type === "voicemail") {
        if (tryAgainDays > 0) {
          await snoozeTouch(selected.id, "call", addDays(today, tryAgainDays));
          toast.push(
            `Voicemail logged — still on your list, back in ${tryAgainDays} ${tryAgainDays === 1 ? "day" : "days"} to try again.`,
            "info",
          );
        } else {
          toast.push(`Voicemail logged for ${selected.householdName} — still due, clock unchanged.`, "info");
        }
      } else if (type === "admin") {
        toast.push(`Admin touch logged for ${selected.householdName} — service clock unchanged.`, "info");
      } else {
        const next = dueDates.find((d) => d.type === type);
        toast.push(
          next
            ? `${CONTACT_TYPE_LABELS[type]} logged — next ${type} due ${formatMedium(next.dueDate)}.`
            : `${CONTACT_TYPE_LABELS[type]} logged.`,
        );
      }
      onClose();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Something went wrong logging the contact.", "error");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Log a contact"
      subtitle="One click. The service engine handles the rest."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Household" group>
          {selected ? (
            <div className="rounded-lg border border-stone-300 bg-stone-50 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <TierBadge tier={selected.tier} />
                  <span className="truncate text-sm font-medium">{selected.householdName}</span>
                  <AdvisorChip advisor={selected.assignedAdvisor} />
                  {selected.heldAway && <HeldAwayBadge note={selected.heldAwayNote} />}
                </div>
                <Button size="sm" variant="ghost" onClick={() => { setClientId(null); setQuery(""); }}>
                  Change
                </Button>
              </div>
              {selected.heldAway && selected.heldAwayNote && (
                <p className="mt-1.5 text-xs font-medium text-emerald-800">
                  💰 {selected.heldAwayNote}
                </p>
              )}
            </div>
          ) : (
            <div>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-2.5 left-3 size-4 text-stone-400" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search households…"
                  className="pl-9"
                />
              </div>
              <div className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-stone-200">
                {matches.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-stone-400">No active household matches.</p>
                ) : (
                  matches.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setClientId(c.id)}
                      className="flex w-full cursor-pointer items-center gap-2 border-b border-stone-100 px-3 py-2 text-left text-sm transition-colors last:border-0 hover:bg-pine-50"
                    >
                      <TierBadge tier={c.tier} />
                      <span className="flex-1 truncate font-medium">{c.householdName}</span>
                      <AdvisorChip advisor={c.assignedAdvisor} />
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </Field>

        <Field label="Type" group>
          <Segmented<ContactType>
            value={type}
            onChange={setType}
            options={[
              { value: "meeting", label: "Meeting", icon: <CalendarIcon className="size-4" /> },
              { value: "call", label: "Call", icon: <PhoneIcon className="size-4" /> },
              { value: "voicemail", label: "Voicemail", icon: <VoicemailIcon className="size-4" /> },
              { value: "admin", label: "Admin", icon: <ClipboardIcon className="size-4" /> },
            ]}
          />
          {type === "call" && (
            <p className="mt-1.5 text-xs text-stone-400">
              A meaningful call — actually reached them. Resets the call clock.
            </p>
          )}
          {type === "voicemail" && (
            <p className="mt-1.5 text-xs text-violet-700">
              Tracked as an attempt, but the call stays due — you haven't reached them yet.
            </p>
          )}
          {type === "admin" && (
            <p className="mt-1.5 text-xs text-stone-400">
              Admin touches are recorded but never reset the service clock.
            </p>
          )}
        </Field>

        {type === "voicemail" && (
          <Field label="Try them again" group>
            <div className="flex flex-wrap gap-1.5">
              {TRY_AGAIN_OPTIONS.map((o) => (
                <button
                  key={o.days}
                  type="button"
                  onClick={() => setTryAgainDays(o.days)}
                  className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    tryAgainDays === o.days
                      ? "bg-pine-700 text-white"
                      : "bg-stone-100 text-ink-soft hover:bg-stone-200"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-stone-400">
              Snoozes the call off today's list and brings it back when it's time to try again.
            </p>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date">
            <Input
              type="date"
              required
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Logged for">
            <Select value={advisor} onChange={(e) => setAdvisor(e.target.value as AdvisorKey)}>
              {ADVISOR_KEYS.map((k) => (
                <option key={k} value={k}>
                  {ADVISOR_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Duration (minutes)" group>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={1440}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="Optional"
              className="w-28"
            />
            <div className="flex gap-1.5">
              {DURATION_CHIPS[type].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDuration(String(m))}
                  className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    duration === String(m)
                      ? "bg-pine-700 text-white"
                      : "bg-stone-100 text-ink-soft hover:bg-stone-200"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </Field>

        <Field label="Notes (optional)">
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What mattered in this touch?"
          />
        </Field>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!selected || !date || busy}>
            {busy && <Spinner className="size-3.5 border-white/40 border-t-white" />}
            Log it
          </Button>
        </div>
      </form>
    </Modal>
  );
}
