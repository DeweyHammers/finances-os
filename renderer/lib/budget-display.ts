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
      return {
        liveName: bill.name,
        displayName: `${bill.name} ($${amount} - ${bill.dueDate}${getOrdinal(bill.dueDate)})`,
        cycles: [bill.withdrawalCycle],
      };
    }
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
    return {
      liveName: item.name,
      displayName: item.name,
      cycles: item.customCycle ? [item.customCycle] : [],
    };
  }

  return { liveName: item.name, displayName: item.name, cycles: [] };
};
