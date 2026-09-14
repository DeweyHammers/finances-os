/**
 * budget-display — Resolves the "current" display label for a budget item.
 *
 * A CategoryItem in the Plan is a lightweight pointer: `sourceType` is BILL,
 * PERSONAL_NAME, or CUSTOM, and it references a Bill.id / Personal.name /
 * inline custom amount. When the underlying Bill (amount, dueDate) or
 * Personal (amount) changes, we want the Plan UI to reflect the LIVE values
 * without editing the item's own denormalized `name`. `resolveItemDisplay`
 * does the join at render time and gracefully falls back to the item's own
 * stored name when the source has been removed (so the Plan doesn't crash
 * on an orphaned reference — the user just sees the old label).
 */
import { getOrdinal } from "./date-utils";

export interface DisplayBill {
  id: string;
  name: string;
  amount: number;
  dueDate: number;
  withdrawalCycle: string;
}

export interface DisplayPersonal {
  name: string;
  amount?: number;
  withdrawalCycle: string;
}

export interface DisplayableItem {
  name: string;
  sourceType: string;
  sourceBillId?: string | null;
  sourcePersonalName?: string | null;
  customCycle?: string | null;
}

export interface ItemDisplay {
  liveName: string;
  displayName: string;
  cycles: string[];
}

/**
 * Resolves the up-to-date display info for a budget category item by joining
 * against the current Bills/Personals records. Falls back to the item's own
 * stored name when the source has been removed.
 *
 * - liveName: just the name from the source (or the item's own name as
 *   fallback). Use this for editing UIs.
 * - displayName: the rich label used in the Plan ("Name ($Amount - 5th)" for
 *   bills). Use this for read-only lists like the Move/Assign popovers.
 */
export const resolveItemDisplay = (
  item: DisplayableItem,
  bills: DisplayBill[],
  personals: DisplayPersonal[],
): ItemDisplay => {
  if (item.sourceType === "BILL") {
    const bill = bills.find((b) => b.id === item.sourceBillId);
    if (bill) {
      const amount = Number(bill.amount).toFixed(2);
      // Rich label format: "Netflix ($15.99 - 5th)". Includes the live
      // amount + due date so the Plan surfaces bill changes without needing
      // the user to re-add the item.
      return {
        liveName: bill.name,
        displayName: `${bill.name} ($${amount} - ${bill.dueDate}${getOrdinal(bill.dueDate)})`,
        cycles: [bill.withdrawalCycle],
      };
    }
    // Bill was deleted — keep the item's own stored name so the Plan row
    // still renders. User can manually delete or re-link.
    return { liveName: item.name, displayName: item.name, cycles: [] };
  }

  if (item.sourceType === "PERSONAL_NAME") {
    const live = personals.find((p) => p.name === item.sourcePersonalName);
    const name = live?.name ?? item.sourcePersonalName ?? item.name;
    // Personal items can have many records under the same name across
    // different cycles — the Plan item is the aggregate, so we deliberately
    // omit a cycle chip here.
    if (live && typeof live.amount === "number") {
      return {
        liveName: name,
        displayName: `${name} ($${Number(live.amount).toFixed(2)})`,
        cycles: [],
      };
    }
    return { liveName: name, displayName: name, cycles: [] };
  }

  if (item.sourceType === "CUSTOM") {
    // Custom items store all display data on themselves — no join needed.
    // A null customCycle means "every cycle" (renders without a chip).
    return {
      liveName: item.name,
      displayName: item.name,
      cycles: item.customCycle ? [item.customCycle] : [],
    };
  }

  // Unknown sourceType — degrade to raw name rather than crash.
  return { liveName: item.name, displayName: item.name, cycles: [] };
};
