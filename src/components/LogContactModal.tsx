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
import type { ContactType, TouchAuthor } from "../types";
import { TOUCH_AUTHOR_LABELS, TOUCH_AUTHORS, CONTACT_TYPE_LABELS, authorForUser } from "../types";
import { useApp } from "../lib/store";
import { suggestFromNote } from "../lib/noteSuggestions";
import { otherHouseholdMembers } from "../lib/household";
import { sortedTags, tagLabel, type ClientTag } from "../types";
import { useToast } from "../lib/toast";
import { addDays, formatMedium, todayISO } from "../lib/dates";
import { Button, Field, Input, Modal, Segmented, Select, Spinner, Textarea } from "./ui";
import { TierBadge, AdvisorChip, HeldAwayBadge } from "./badges";
import { CalendarIcon, ClipboardIcon, PhoneIcon, SearchIcon, UsersIcon, VoicemailIcon } from "./icons";

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

/** "Ann", "Ann and Ben", "Ann, Ben and Cal". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const TRY_AGAIN_OPTIONS = [
  { label: "Tomorrow", days: 1 },
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
  { label: "Don't snooze", days: 0 },
];

function LogContactForm({ initialClientId, onClose }: { initialClientId: string | null; onClose: () => void }) {
  const { data, currentUser, logContact, snoozeTouch, updateClient, scheduleMeeting, busy, today } =
    useApp();
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
  const [advisor, setAdvisor] = useState<TouchAuthor>(authorForUser(currentUser));
  const [notes, setNotes] = useState("");
  // After leaving a voicemail: snooze the call this many days (0 = don't snooze).
  const [tryAgainDays, setTryAgainDays] = useState(3);
  // Suggestions the advisor has waved off for this note.
  const [declined, setDeclined] = useState<Set<string>>(new Set());
  // Family members this touch should NOT count for. Seeded from each member's
  // standing rule when you pick a household — off for the child or trust that
  // isn't usually in the room — and overridable per touch from there.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const selected = clients.find((c) => c.id === clientId) ?? null;

  // A joint review is one conversation with several households. Each keeps its
  // own tier and its own clock, so each needs its own touch — otherwise the
  // spouse you just spent an hour with still shows up overdue tomorrow.
  const household = useMemo(
    () => (selected ? otherHouseholdMembers(clients, selected) : []),
    [clients, selected],
  );
  const family = selected?.familyId
    ? (data?.families.find((f) => f.id === selected.familyId) ?? null)
    : null;
  const hiddenMembers = family?.hiddenMembers ?? 0;
  const alsoForClientIds = household.filter((m) => !excluded.has(m.id)).map((m) => m.id);
  const coveredCount = 1 + alsoForClientIds.length;

  // Switching households re-applies the standing rules from scratch, dropping
  // whatever you'd overridden for the household you just moved off.
  const ruledOut = household.filter((m) => !m.mirrorTouches);
  useEffect(() => {
    setExcluded(new Set(ruledOut.map((m) => m.id)));
    // Deliberately keyed on the household alone: re-running this whenever the
    // member list is re-derived would undo every tap the moment React
    // re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Default the advisor to whoever owns the household (joint → current user).
  useEffect(() => {
    if (!selected) return;
    if (currentUser?.role === "assistant") {
      setAdvisor("assistant"); // the assistant logs as herself by default
    } else if (selected.assignedAdvisor !== "joint") {
      setAdvisor(selected.assignedAdvisor);
    } else {
      setAdvisor(authorForUser(currentUser));
    }
  }, [selected, currentUser]);

  // What the note implies: opportunity tags, and when to see them next.
  // Nothing leaves the browser — this is keyword matching over the firm's own
  // tag list, so it is instant and always says the same thing.
  const tagDefs = useMemo(() => sortedTags(data?.clientTags ?? []), [data]);
  const suggestions = useMemo(
    () =>
      selected
        ? suggestFromNote(notes, selected.tags, today, tagDefs)
        : { tags: [] as ClientTag[], meetingDate: null, meetingPhrase: null },
    [notes, selected, today, tagDefs],
  );
  const keptTags = suggestions.tags.filter((t) => !declined.has(t));
  const keepMeeting = Boolean(suggestions.meetingDate) && !declined.has("__meeting");

  function toggleHouseholdMember(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSuggestion(key: string) {
    setDeclined((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? clients.filter((c) => c.householdName.toLowerCase().includes(q)) : clients;
    return pool.slice(0, 8);
  }, [clients, query]);

  async function submit() {
    if (!selected) return;
    // "for the Whitfields and 1 other household" reads better than a raw count
    // and makes it obvious when the fan-out did more than you expected.
    const covering =
      alsoForClientIds.length > 0
        ? ` for ${coveredCount} households`
        : ` for ${selected.householdName}`;
    try {
      const dueDates = await logContact({
        clientId: selected.id,
        advisor,
        type,
        eventDate: date,
        durationMinutes: duration.trim() === "" ? null : Math.max(0, Number(duration)),
        notes: notes.trim() || null,
        alsoForClientIds,
      });
      if (type === "voicemail") {
        if (tryAgainDays > 0) {
          // The whole household is still waiting to hear back, not just the
          // number you happened to dial.
          for (const id of [selected.id, ...alsoForClientIds]) {
            await snoozeTouch(id, "call", addDays(today, tryAgainDays));
          }
          toast.push(
            `Voicemail logged${covering} — still on your list, back in ${tryAgainDays} ${tryAgainDays === 1 ? "day" : "days"} to try again.`,
            "info",
          );
        } else {
          toast.push(`Voicemail logged${covering} — still due, clock unchanged.`, "info");
        }
      } else if (type === "admin") {
        toast.push(`Admin touch logged${covering} — service clock unchanged.`, "info");
      } else {
        const next = dueDates.find((d) => d.type === type);
        toast.push(
          next
            ? `${CONTACT_TYPE_LABELS[type]} logged${covering} — next ${type} for ${selected.householdName} due ${formatMedium(next.dueDate)}.`
            : `${CONTACT_TYPE_LABELS[type]} logged${covering}.`,
        );
      }

      // Everything the advisor kept from the note. Done after the log so the
      // booking survives (logging a meeting clears one already due).
      //
      // Tags stay on the household you picked — an opportunity belongs to
      // somebody specific, and guessing which spouse owns the Roth would be
      // worse than leaving it to a tap. The follow-up booking does fan out:
      // "see them again in the fall" means the same appointment.
      if (keptTags.length > 0) {
        await updateClient(selected.id, { tags: [...selected.tags, ...keptTags] });
      }
      if (keepMeeting && suggestions.meetingDate) {
        for (const id of [selected.id, ...alsoForClientIds]) {
          await scheduleMeeting(id, suggestions.meetingDate, null);
        }
      }
      const extras: string[] = [];
      if (keptTags.length > 0) {
        extras.push(`tagged ${keptTags.map((t) => tagLabel(tagDefs, t)).join(", ")}`);
      }
      if (keepMeeting && suggestions.meetingDate) {
        extras.push(`booked ${formatMedium(suggestions.meetingDate)}`);
      }
      if (extras.length > 0) toast.push(`Also ${extras.join(" · ")}.`, "info");

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
                {/* Identity on its own line at phone width; the badges wrap
                    underneath instead of crushing the name. */}
                <div className="flex min-w-0 flex-1 items-center gap-2 max-sm:flex-col max-sm:items-stretch max-sm:gap-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <TierBadge tier={selected.tier} />
                    <span className="truncate text-sm font-medium">{selected.householdName}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <AdvisorChip advisor={selected.assignedAdvisor} />
                    {selected.heldAway && <HeldAwayBadge note={selected.heldAwayNote} />}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 max-sm:min-h-11"
                  onClick={() => { setClientId(null); setQuery(""); }}
                >
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

        {selected && (household.length > 0 || hiddenMembers > 0) && (
          <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <UsersIcon className="size-3.5 text-stone-400" />
              Also counts for {family?.name ?? "the family"}
            </p>
            {household.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {household.map((m) => {
                  const on = !excluded.has(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleHouseholdMember(m.id)}
                      aria-pressed={on}
                      className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        on
                          ? "border-pine-600 bg-pine-700 text-white"
                          : "border-stone-300 bg-white text-ink-soft hover:bg-white"
                      }`}
                    >
                      {on ? "✓ " : "+ "}
                      {m.householdName}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
              {alsoForClientIds.length > 0
                ? "Each household keeps its own clock — this logs the same touch for each, so nobody in the family is left showing overdue."
                : "Just this household. Tap a name to include them."}
            </p>
            {ruledOut.length > 0 && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-soft">
                {joinNames(ruledOut.map((m) => m.householdName))}{" "}
                {ruledOut.length === 1 ? "is" : "are"} set not to mirror. Tap to include{" "}
                {ruledOut.length === 1 ? "them" : "any of them"} just this once.
              </p>
            )}
            {hiddenMembers > 0 && (
              <p className="mt-1.5 text-[11px] leading-relaxed font-medium text-clay-800">
                {hiddenMembers} more in this family {hiddenMembers === 1 ? "is" : "are"} in another
                advisor's book — you can't log for {hiddenMembers === 1 ? "them" : "those"} from
                here.
              </p>
            )}
          </div>
        )}

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
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What mattered in this touch? Tap your mic and just talk."
          />
        </Field>

        {selected && (suggestions.tags.length > 0 || suggestions.meetingDate) && (
          <div className="animate-rise rounded-xl border border-pine-200 bg-pine-50/70 p-3">
            <p className="text-xs font-semibold tracking-wide text-pine-900 uppercase">
              From what you said
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.tags.map((t) => {
                const on = !declined.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleSuggestion(t)}
                    className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      on
                        ? "border-pine-600 bg-pine-700 text-white"
                        : "border-stone-300 bg-white text-ink-soft hover:bg-stone-50"
                    }`}
                  >
                    {on ? "✓ " : "+ "}
                    {tagLabel(tagDefs, t)}
                  </button>
                );
              })}
              {suggestions.meetingDate && (
                <button
                  type="button"
                  onClick={() => toggleSuggestion("__meeting")}
                  className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    keepMeeting
                      ? "border-pine-600 bg-pine-700 text-white"
                      : "border-stone-300 bg-white text-ink-soft hover:bg-stone-50"
                  }`}
                >
                  {keepMeeting ? "✓ " : "+ "}
                  Book {formatMedium(suggestions.meetingDate)}
                </button>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-pine-900/70">
              Tap any to drop it — nothing is saved until you log the contact.
              {suggestions.meetingPhrase ? ` Heard \u201c${suggestions.meetingPhrase}\u201d.` : ""}
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1 max-sm:sticky max-sm:bottom-[calc(max(1.25rem,env(safe-area-inset-bottom))*-1)] max-sm:z-10 max-sm:-mx-5 max-sm:-mb-[max(1.25rem,env(safe-area-inset-bottom))] max-sm:border-t max-sm:border-stone-200 max-sm:bg-white max-sm:px-5 max-sm:pt-3 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]">
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
