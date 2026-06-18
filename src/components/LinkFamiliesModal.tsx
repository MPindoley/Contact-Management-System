// Link families by last name, on demand (not just at CSV import). Households
// are grouped within a single book — never across advisors — and every group
// is previewed with a checkbox, so you choose exactly what merges.

import { useMemo, useState } from "react";
import { useApp } from "../lib/store";
import { useToast } from "../lib/toast";
import { planSurnameLinks } from "../lib/familyLink";
import { ADVISOR_LABELS, type AdvisorAssignment } from "../types";
import { AdvisorChip, TierBadge } from "./badges";
import { Button, Modal, Select, Spinner } from "./ui";

export function LinkFamiliesModal({ onClose }: { onClose: () => void }) {
  const { data, currentUser, linkFamily, busy } = useApp();
  const toast = useToast();
  // Which book to consider. Default to the signed-in advisor's own book; the
  // assistant (no book) defaults to all. Groups never cross books regardless.
  const [book, setBook] = useState<"all" | AdvisorAssignment>(() => currentUser?.advisorKey ?? "all");
  // Groups the user has unchecked (by key).
  const [skip, setSkip] = useState<Set<string>>(new Set());

  const allGroups = useMemo(() => (data ? planSurnameLinks(data.clients) : []), [data]);
  const books = useMemo(() => [...new Set(allGroups.map((g) => g.advisor))], [allGroups]);
  // If the default book has no candidates, fall back to showing all.
  const effectiveBook = book !== "all" && !books.includes(book) ? "all" : book;
  const groups = useMemo(
    () => allGroups.filter((g) => effectiveBook === "all" || g.advisor === effectiveBook),
    [allGroups, effectiveBook],
  );

  const selected = groups.filter((g) => !skip.has(g.key));
  const householdCount = selected.reduce((n, g) => n + g.clients.length, 0);

  function toggle(key: string) {
    setSkip((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function apply() {
    if (selected.length === 0) return;
    try {
      for (const g of selected) {
        const ids = g.clients.map((c) => c.id);
        await linkFamily(ids, null, `${g.surname} Family`, { [ids[0]]: "head" });
      }
      toast.push(
        `Linked ${selected.length} ${selected.length === 1 ? "family" : "families"} (${householdCount} households). Set spouse/child roles or unlink from any client's profile.`,
      );
      onClose();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't link families.", "error");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Link families by last name"
      subtitle="Group households that share a surname — within one book only, so different advisors' clients never merge."
    >
      {allGroups.length === 0 ? (
        <p className="rounded-lg bg-pine-50 px-4 py-6 text-center text-sm text-pine-800">
          No un-linked households share a last name. Nothing to link right now.
        </p>
      ) : (
        <div className="space-y-4">
          {books.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-ink-soft">Book</span>
              <div className="w-52">
                <Select
                  value={effectiveBook}
                  onChange={(e) => setBook(e.target.value as "all" | AdvisorAssignment)}
                  aria-label="Book to link within"
                >
                  <option value="all">All books (kept separate)</option>
                  {books.map((b) => (
                    <option key={b} value={b}>
                      {ADVISOR_LABELS[b]}’s book
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {groups.length === 0 ? (
            <p className="rounded-lg bg-stone-50 px-4 py-5 text-center text-sm text-ink-soft">
              No same-last-name households in this book.
            </p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto pr-0.5">
              {groups.map((g) => {
                const on = !skip.has(g.key);
                return (
                  <li
                    key={g.key}
                    className={`rounded-xl border p-3 transition-colors ${
                      on ? "border-pine-300 bg-pine-50/40" : "border-stone-200 bg-stone-50 opacity-60"
                    }`}
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(g.key)}
                        className="mt-1 size-4 cursor-pointer accent-pine-700"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{g.surname} Family</span>
                          <AdvisorChip advisor={g.advisor} />
                          <span className="text-xs text-stone-400">
                            {g.clients.length} households
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {g.clients.map((c) => (
                            <span
                              key={c.id}
                              className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-0.5 text-xs"
                            >
                              <TierBadge tier={c.tier} />
                              {c.householdName}
                            </span>
                          ))}
                        </div>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xs text-xs text-stone-400">
              The first household becomes the head; adjust roles afterward from any profile’s Family
              panel.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" disabled={busy || selected.length === 0} onClick={() => void apply()}>
                {busy && <Spinner className="size-3.5 border-white/40 border-t-white" />}
                Link {selected.length} {selected.length === 1 ? "family" : "families"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
