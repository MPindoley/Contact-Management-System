// Re-grade the existing book from the saved tier criteria, so editing a
// tier's revenue floor updates clients without another CSV import. Households
// with no AUM on file are skipped (nothing to grade them by). Family members
// are graded on their COMBINED assets, so spouses land in the same tier.

import type { Client, ServiceModel, Tier } from "../types";
import { tierFromCriteria } from "../lib/importCsv";

export interface RetierChange {
  clientId: string;
  householdName: string;
  fromTier: Tier;
  toTier: Tier;
}

export function planRetier(clients: Client[], serviceModels: ServiceModel[]): RetierChange[] {
  const criteria = serviceModels.map((m) => ({ tier: m.tier, minRevenue: m.minRevenue }));

  // Combined assets per family (only members that have AUM on file count).
  const familyTotals = new Map<string, number>();
  for (const c of clients) {
    if (c.familyId && c.revenue != null) {
      familyTotals.set(c.familyId, (familyTotals.get(c.familyId) ?? 0) + c.revenue);
    }
  }

  const changes: RetierChange[] = [];
  for (const c of clients) {
    if (!c.active) continue;
    const familyTotal = c.familyId ? familyTotals.get(c.familyId) : undefined;
    const effective = familyTotal && familyTotal > 0 ? familyTotal : c.revenue;
    if (effective == null) continue; // no AUM → leave the tier as set by hand
    const target = tierFromCriteria(effective, criteria);
    if (target !== c.tier) {
      changes.push({ clientId: c.id, householdName: c.householdName, fromTier: c.tier, toTier: target });
    }
  }
  return changes;
}
