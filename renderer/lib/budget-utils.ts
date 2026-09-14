/**
 * budget-utils — YNAB-style budget math + auto-assign resolvers.
 *
 * Pure functions consumed by BudgetPage, AssignMoneyPopover, and any Overview
 * widget that needs "how much should this category get this pay-week?".
 * All money is in integer cents. Bill.amount / Personal.amount live in the
 * DB as Decimal dollars — the resolvers cast via `Number(...)` and
 * `Math.round(x * 100)` to convert.
 *
 * Two auto-assign flavors:
 *  - `resolveAutoAssignAmount` — month-level (matches item's withdrawalCycle
 *    to a Q1..Q4 quarter).
 *  - `resolveAutoAssignAmountForPeriod` — pay-period-aware (uses the actual
 *    pay-week the bill/personal lands in, honoring BillSplit rows for
 *    cumulative funding). See CLAUDE.md "Auto-assign amounts" for the
 *    precise semantics per source type.
 */
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

export interface BillRecordWithDueDate {
  id: string;
  amount: number;
  dueDate: number;
}

export interface PersonalRecordExtended {
  name: string;
  amount: number;
  dueDate?: number;
  weekOfMonth?: number | null;
  repeatWeekly?: boolean;
  splitAcrossWeeks?: boolean;
}

// ── Month key helpers ──
// All month math uses UTC components so a user in PST doesn't shift a
// midnight-UTC date back into the previous month locally.

/** "YYYY-MM" key used for grouping monthly rows (BudgetMonth, BillSplit). */
export const monthKey = (date: string | Date): string => {
  const d = typeof date === "string" ? new Date(date) : date;
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${y}-${m}`;
};

/** First-of-previous-month at UTC midnight. Used by carryover computation. */
export const prevMonth = (monthIso: string | Date): Date => {
  const d = typeof monthIso === "string" ? new Date(monthIso) : monthIso;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
};

/** First-of-current-month at UTC midnight. */
export const monthStart = (date: string | Date): Date => {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

/** True iff `date` and `month` fall in the same calendar month (UTC). */
export const isInMonth = (
  date: string | Date,
  month: string | Date,
): boolean => {
  return monthKey(date) === monthKey(month);
};

// ── YNAB-style monthly rollup math ──

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

// ── Auto-assign resolvers ──

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
    // A null customCycle means "assign every cycle" (repeat monthly). Only
    // when a specific cycle is set do we require an exact match.
    if (item.customCycle == null) return item.customAmountCents;
    if (item.customCycle === cycle) return item.customAmountCents;
    return 0;
  }

  return 0;
};

/**
 * Period-aware auto-assign: resolves how much to assign for a category item
 * in the given pay period (identified by periodKey like "P1").
 * - BILL: assigns bill.amount when the bill's dueDate (or override) lands in that period.
 * - PERSONAL_NAME: assigns per cadence — split (pre-computed per-period), weekOfMonth,
 *   repeatWeekly, or dueDate.
 * - CUSTOM: assigns customAmountCents only when customCycle is null (always).
 */
import {
  PayPeriod,
  getBillPeriodKey,
  getBillAllocationsForBill,
  BillSplitRecord,
} from "./pay-period-utils";

export const resolveAutoAssignAmountForPeriod = (params: {
  item: CategoryItem;
  periodKey: string;
  periods: PayPeriod[];
  bills: BillRecordWithDueDate[];
  personals: PersonalRecordExtended[];
  splits?: BillSplitRecord[];
  monthKey?: string;
  splitAllocationsByPersonalName?: Record<string, number>;
}): number => {
  const {
    item,
    periodKey,
    periods,
    bills,
    personals,
    splits,
    monthKey,
    splitAllocationsByPersonalName,
  } = params;

  if (item.sourceType === "BILL") {
    const bill = bills.find((b) => b.id === item.sourceBillId);
    if (!bill) return 0;
    // Preferred path: consult persisted BillSplit rows so we honor the
    // auto-balance algorithm's per-week decisions (may split a single bill
    // across multiple pay weeks to level the total).
    if (splits && monthKey) {
      const allocs = getBillAllocationsForBill(
        bill.id,
        Number(bill.dueDate),
        Number(bill.amount),
        periods,
        monthKey,
        splits,
      );
      if (allocs.length === 0) return 0;
      // Split bills fund their target cumulatively across pay weeks — hitting
      // Auto for P3 should top the category up to the sum of slices through
      // P3, not just P3's slice (which would go negative and add nothing once
      // prior weeks have covered more than this week's share).
      if (allocs.length > 1) {
        const targetIdx = periods.findIndex((p) => p.key === periodKey);
        if (targetIdx < 0) return 0;
        return allocs
          .filter((a) => a.weekIndex <= targetIdx)
          .reduce((acc, a) => acc + a.amountCents, 0);
      }
      // Single-week bill: only fund in its natural period.
      const only = allocs[0];
      return only.periodKey === periodKey ? only.amountCents : 0;
    }
    // No splits provided — fall back to due-date attribution with full amount.
    const attributedKey = getBillPeriodKey(Number(bill.dueDate), periods);
    if (attributedKey !== periodKey) return 0;
    return Math.round(bill.amount * 100);
  }

  if (item.sourceType === "PERSONAL_NAME") {
    if (!item.sourcePersonalName) return 0;
    const match = personals.find((p) => p.name === item.sourcePersonalName);
    if (!match) return 0;
    if (match.splitAcrossWeeks) {
      // Split personals fund cumulatively via caller-computed slices summed
      // through the target period (matches the split-bill semantics above).
      return splitAllocationsByPersonalName?.[item.sourcePersonalName] ?? 0;
    }
    // repeatWeekly personals (Gas, Spending) always get a fresh full amount
    // each pay week — deliberately NOT a cumulative top-up. See CLAUDE.md.
    if (match.repeatWeekly) return Math.round(match.amount * 100);
    // Single-fire personals attribute either by explicit weekOfMonth (P1..P4)
    // or by dueDate via getBillPeriodKey (with the same forward-extension
    // rules as bills).
    const attributedKey =
      match.weekOfMonth != null
        ? `P${match.weekOfMonth}`
        : getBillPeriodKey(Number(match.dueDate ?? 1), periods);
    if (attributedKey !== periodKey) return 0;
    return Math.round(match.amount * 100);
  }

  if (item.sourceType === "CUSTOM") {
    // In period-aware mode we only honor customCycle=null (monthly repeat).
    // Cycle-specific customs are ambiguous under pay-period thinking and are
    // deliberately skipped rather than guessed.
    if (item.customAmountCents == null) return 0;
    if (item.customCycle == null) return item.customAmountCents;
    return 0;
  }

  return 0;
};

/**
 * Returns the cents that a category item's `assignedCents` SHOULD contain by
 * the end of pay week `throughPeriodIdx` (0-based, e.g. 2 = "cumulative
 * through P3"). Mirrors the auto-assign flow: for each period 0..idx we ask
 * `resolveAutoAssignAmountForPeriod` what Auto would target for that period,
 * then combine per the item's cadence:
 *
 *   - REPEATING (personal.repeatWeekly, custom w/ null cycle handled as flat
 *     each period): SUM targets — each pay week adds a fresh allowance.
 *   - CUMULATIVE (bills w/ splits, split personals): MAX targets — the
 *     resolver already returns the running total through the target period,
 *     so max is equivalent to "the highest cumulative snapshot seen so far".
 *   - ONE-SHOT (un-split bills, dated personals, custom w/ specific cycle):
 *     MAX targets — the resolver returns full amount in the natural period
 *     and 0 elsewhere, so max latches on once that period passes.
 *
 * Custom items with `customCycle == null` fire once per month (not per pay
 * week), so we treat them as MAX (single fire) rather than SUM.
 *
 * Returns 0 when idx < 0 (no pay week of the current month has started yet).
 * Used by the Plan page to detect envelopes whose assigned amount lags what
 * the current bill schedule expects.
 */
export const computeExpectedAssignedThroughPeriod = (params: {
  item: CategoryItem;
  throughPeriodIdx: number;
  periods: PayPeriod[];
  bills: BillRecordWithDueDate[];
  personals: PersonalRecordExtended[];
  splits?: BillSplitRecord[];
  monthKey?: string;
  splitAllocationsByPersonalNameThroughPeriod?: Record<string, number[]>;
}): number => {
  const {
    item,
    throughPeriodIdx,
    periods,
    bills,
    personals,
    splits,
    monthKey,
    splitAllocationsByPersonalNameThroughPeriod,
  } = params;

  if (throughPeriodIdx < 0) return 0;

  // Decide combine mode from the item's source.
  const personalMatch =
    item.sourceType === "PERSONAL_NAME"
      ? personals.find((p) => p.name === item.sourcePersonalName)
      : null;
  const isRepeating =
    item.sourceType === "PERSONAL_NAME" && Boolean(personalMatch?.repeatWeekly);
  // (CUSTOM null-cycle repeats monthly not weekly, so MAX is the right mode.)

  let expected = 0;
  for (let i = 0; i <= throughPeriodIdx && i < periods.length; i++) {
    // For split-personals we need the cumulative slice sum through period i
    // (not through the final target period). Pull the caller-computed slice
    // array and truncate here so each i sees the right cumulative view.
    const splitAllocationsByPersonalName: Record<string, number> = {};
    if (
      splitAllocationsByPersonalNameThroughPeriod &&
      item.sourceType === "PERSONAL_NAME" &&
      item.sourcePersonalName
    ) {
      const slices =
        splitAllocationsByPersonalNameThroughPeriod[item.sourcePersonalName] ??
        [];
      splitAllocationsByPersonalName[item.sourcePersonalName] = slices
        .slice(0, i + 1)
        .reduce((a, b) => a + b, 0);
    }

    const target = resolveAutoAssignAmountForPeriod({
      item,
      periodKey: periods[i].key,
      periods,
      bills,
      personals,
      splits,
      monthKey,
      splitAllocationsByPersonalName,
    });
    if (isRepeating) expected += target;
    else expected = Math.max(expected, target);
  }
  return expected;
};

// ── Money-move + balance-adjustment builders ──

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
