export interface BudgetTransaction {
  date: string | Date;
  categoryItemId: string | null;
  inflowCents: number;
  outflowCents: number;
}

export interface CategoryItem {
  id: string;
  sourceType: "BILL" | "PERSONAL_NAME" | "CUSTOM";
  sourceBillId?: string | null;
  sourcePersonalName?: string | null;
  customAmountCents?: number | null;
  customCycle?: string | null;
}

export interface BillRecord {
  id: string;
  amount: number;
  withdrawalCycle: string;
}

export interface PersonalRecord {
  name: string;
  amount: number;
  withdrawalCycle: string;
}

export const monthKey = (date: string | Date): string => {
  const d = typeof date === "string" ? new Date(date) : date;
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${y}-${m}`;
};

export const prevMonth = (monthIso: string | Date): Date => {
  const d = typeof monthIso === "string" ? new Date(monthIso) : monthIso;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
};

export const monthStart = (date: string | Date): Date => {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

export const isInMonth = (
  date: string | Date,
  month: string | Date,
): boolean => {
  return monthKey(date) === monthKey(month);
};

/**
 * Activity = sum of (outflow - inflow) for transactions in the month against this category.
 * Positive means money flowed out of the category (spending).
 */
export const computeActivity = (
  transactions: BudgetTransaction[],
  itemId: string,
  month: string | Date,
): number => {
  return transactions
    .filter((t) => t.categoryItemId === itemId && isInMonth(t.date, month))
    .reduce(
      (acc, t) => acc + (t.outflowCents || 0) - (t.inflowCents || 0),
      0,
    );
};

/**
 * Available = max(0, prior available) + assigned this month - activity this month.
 * Cash overspending zeroes out and is absorbed by Ready to Assign in the next month.
 */
export const computeAvailable = (params: {
  priorAvailable: number;
  assignedCents: number;
  activityCents: number;
}): number => {
  const carry = Math.max(0, params.priorAvailable);
  return carry + params.assignedCents - params.activityCents;
};

/**
 * Ready to Assign = total inflows minus outflows for un-categorized transactions
 * (categoryItemId === null) across all time, minus total assigned across all
 * months and items.
 *
 * categoryItemId-null inflows include income and balance-adjustment inflows.
 * categoryItemId-null outflows include balance-adjustment debits.
 */
export const computeReadyToAssign = (params: {
  transactions: BudgetTransaction[];
  assignments: { assignedCents: number }[];
}): number => {
  const uncategorized = params.transactions
    .filter((t) => t.categoryItemId == null)
    .reduce(
      (acc, t) => acc + (t.inflowCents || 0) - (t.outflowCents || 0),
      0,
    );
  const totalAssigned = params.assignments.reduce(
    (acc, a) => acc + (a.assignedCents || 0),
    0,
  );
  return uncategorized - totalAssigned;
};

/**
 * Account balance = sum(inflow) - sum(outflow) over its transactions.
 */
export const computeAccountBalance = (
  transactions: { inflowCents: number; outflowCents: number }[],
): number => {
  return transactions.reduce(
    (acc, t) => acc + (t.inflowCents || 0) - (t.outflowCents || 0),
    0,
  );
};

/**
 * Resolves how much to auto-assign for a category item in a given quarter cycle.
 * - BILL: Bill.amount (in cents) when the bill's withdrawalCycle matches the cycle.
 * - PERSONAL_NAME: Personal.amount for the (name, cycle) match.
 * - CUSTOM: customAmountCents when customCycle matches OR customCycle is null.
 *
 * Returns 0 (skip) for any miss.
 */
export const resolveAutoAssignAmount = (params: {
  item: CategoryItem;
  cycle: string;
  bills: BillRecord[];
  personals: PersonalRecord[];
}): number => {
  const { item, cycle, bills, personals } = params;

  if (item.sourceType === "BILL") {
    const bill = bills.find((b) => b.id === item.sourceBillId);
    if (!bill) return 0;
    if (bill.withdrawalCycle !== cycle) return 0;
    return Math.round(bill.amount * 100);
  }

  if (item.sourceType === "PERSONAL_NAME") {
    if (!item.sourcePersonalName) return 0;
    const match = personals.find(
      (p) =>
        p.name === item.sourcePersonalName && p.withdrawalCycle === cycle,
    );
    if (!match) return 0;
    return Math.round(match.amount * 100);
  }

  if (item.sourceType === "CUSTOM") {
    if (item.customAmountCents == null) return 0;
    if (item.customCycle == null) return item.customAmountCents;
    if (item.customCycle === cycle) return item.customAmountCents;
    return 0;
  }

  return 0;
};

/**
 * Returns a pair of {sourceDelta, destDelta} (in cents) for moving money
 * between two budget items' assignments. Throws on invalid inputs.
 */
export const moveMoney = (params: {
  sourceItemId: string;
  destItemId: string;
  amountCents: number;
}): { sourceDelta: number; destDelta: number } => {
  if (params.sourceItemId === params.destItemId) {
    throw new Error("Source and destination must differ");
  }
  if (!Number.isFinite(params.amountCents) || params.amountCents <= 0) {
    throw new Error("Amount must be a positive number");
  }
  return {
    sourceDelta: -params.amountCents,
    destDelta: params.amountCents,
  };
};

/**
 * Builds an adjustment transaction for an account balance edit.
 * Returns null if the new balance equals the current.
 */
export const buildBalanceAdjustment = (params: {
  accountId: string;
  currentBalanceCents: number;
  newBalanceCents: number;
}): {
  accountId: string;
  payeeId: null;
  isAdjustment: true;
  inflowCents: number;
  outflowCents: number;
  categoryItemId: null;
  cleared: true;
} | null => {
  const delta = params.newBalanceCents - params.currentBalanceCents;
  if (delta === 0) return null;
  return {
    accountId: params.accountId,
    payeeId: null,
    isAdjustment: true,
    inflowCents: delta > 0 ? delta : 0,
    outflowCents: delta < 0 ? -delta : 0,
    categoryItemId: null,
    cleared: true,
  };
};
