// Planning family links by surname — but only WITHIN a book. Two households
// that share a last name across *different* advisors' books used to merge into
// one family (e.g. Matt's "Nguyen" and Beau's unrelated "Nguyen"); that was
// wrong. Households only pair up when they share the same assigned advisor AND
// the same surname, so books never bleed into each other.

import { ADVISOR_LABELS, type AdvisorAssignment, type Client } from "../types";
import { surnameOf } from "./importCsv";

export interface SurnameGroup {
  /** Stable key, `${advisor}|${surname}` — unique per book+surname. */
  key: string;
  /** Display-cased surname, e.g. "Whitfield". */
  surname: string;
  advisor: AdvisorAssignment;
  advisorLabel: string;
  /** The households to link (always two or more), input order preserved. */
  clients: Client[];
}

export interface PlanSurnameOptions {
  /** Limit to a single book. Omit to plan every book (each grouped on its own). */
  advisor?: AdvisorAssignment;
}

/**
 * Group un-familied, active households that share a surname *and* a book.
 * Returns one entry per book+surname that has two or more households; surnames
 * shared across books are never combined.
 */
export function planSurnameLinks(
  clients: Client[],
  opts: PlanSurnameOptions = {},
): SurnameGroup[] {
  const groups = new Map<string, Client[]>();
  for (const c of clients) {
    if (c.familyId) continue; // never disturb an existing family
    if (!c.active) continue; // leave deactivated households out
    if (opts.advisor && c.assignedAdvisor !== opts.advisor) continue;
    const sn = surnameOf(c.householdName);
    if (!sn) continue;
    const key = `${c.assignedAdvisor}|${sn}`;
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }

  const out: SurnameGroup[] = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const sn = surnameOf(members[0].householdName)!;
    out.push({
      key,
      surname: sn.charAt(0).toUpperCase() + sn.slice(1),
      advisor: members[0].assignedAdvisor,
      advisorLabel: ADVISOR_LABELS[members[0].assignedAdvisor],
      clients: members,
    });
  }
  // Friendly, stable order: by book, then surname.
  out.sort(
    (a, b) => a.advisorLabel.localeCompare(b.advisorLabel) || a.surname.localeCompare(b.surname),
  );
  return out;
}
