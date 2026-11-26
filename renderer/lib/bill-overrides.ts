/**
 * bill-overrides — the editing side of "Temporary bill amounts".
 *
 * A bill can cost something else for a few months ("$50 for three months", or
 * $0 while nothing is charged). Each such month is one `BillOverride` row
 * (billId + dueMonth as a YYYYMM number + amount). The helpers that APPLY
 * those rows to the plan live in pay-period-utils (`findBillOverride`,
 * `billAmountForMonth`, `billAmountsByCoord`, `getBillAllocationsForBill`);
 * this file holds what the bill's edit form and the Bills list need: month
 * arithmetic, turning rows into readable ranges ("Dec 2026 – Feb 2027"), and
 * the batch of writes that sets an amount for a run of months.
 *
 * Pure functions only — no React, no fetch — so they are unit-tested directly
 * (bill-overrides.test.ts). See CLAUDE.md → "Temporary bill amounts".
 */
import type { BatchOperation } from "./batch-api";
import { billMonthKey, formatBillMonth, type BillOverrideLike } from "./pay-period-utils";

/** The longest run of months one "Add" can set. A longer change is a new regular amount. */
export const BILL_OVERRIDE_MAX_MONTHS = 12;
/** How many months ahead "Starting" can be moved (this month included): a year. */
export const BILL_OVERRIDE_START_CHOICES = 12;

/** `dueMonth` (YYYYMM) moved by `n` months; crosses year ends either way. */
export function addBillMonths(dueMonth: number, n: number): number {
  return billMonthKey(Math.floor(dueMonth / 100), (dueMonth % 100) - 1 + n);
}

/** `count` consecutive months starting at `start` (YYYYMM), in order. */
export function billMonthsFrom(start: number, count: number): number[] {
  const months: number[] = [];
  for (let i = 0; i < count; i++) months.push(addBillMonths(start, i));
  return months;
}

/**
 * The month a new temporary amount starts in by default: this month while
 * its payment is still ahead (due today or later), otherwise next month —
 * this month's payment is already behind us, so changing it would do nothing
 * the user expects.
 */
export function defaultOverrideStartMonth(today: Date, dueDay: number): number {
  const thisMonth = billMonthKey(today.getFullYear(), today.getMonth());
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  // A bill due the 31st is due on the last day of a shorter month.
  const dueThisMonth = Math.min(Number.isFinite(dueDay) && dueDay >= 1 ? dueDay : 1, daysInMonth);
  return today.getDate() <= dueThisMonth ? thisMonth : addBillMonths(thisMonth, 1);
}

/** A run of consecutive months in which one bill has the same temporary amount. */
export interface BillOverrideRange {
  fromMonth: number;
  toMonth: number;
  /** Dollars per payment in those months. */
  amount: number;
  /** How many months the run covers. */
  months: number;
  /** The ids of the BillOverride rows behind it — what "remove" deletes. */
  ids: string[];
}

/**
 * One bill's temporary amounts from `fromMonth` on (earlier months are
 * history and are left alone), as runs of consecutive months with the same
 * amount, oldest first. Rows whose amount cannot be read are skipped, exactly
 * as the plan skips them.
 */
export function groupBillOverrideRanges(
  overrides: readonly (BillOverrideLike & { id?: string | null })[] | undefined | null,
  billId: string,
  fromMonth: number,
): BillOverrideRange[] {
  const rows = (overrides ?? [])
    .filter((o) => String(o.billId) === String(billId))
    .map((o) => ({ id: String(o.id ?? ""), dueMonth: Number(o.dueMonth), amount: o.amount == null || o.amount === "" ? NaN : Number(o.amount) }))
    .filter((o) => Number.isFinite(o.dueMonth) && o.dueMonth >= fromMonth && Number.isFinite(o.amount) && o.amount >= 0)
    .sort((a, b) => a.dueMonth - b.dueMonth);

  const ranges: BillOverrideRange[] = [];
  for (const row of rows) {
    const last = ranges[ranges.length - 1];
    // Same amount (to the cent) in the month right after the run → extend it.
    if (last && addBillMonths(last.toMonth, 1) === row.dueMonth && Math.round(last.amount * 100) === Math.round(row.amount * 100)) {
      last.toMonth = row.dueMonth;
      last.months += 1;
      last.ids.push(row.id);
    } else {
      ranges.push({ fromMonth: row.dueMonth, toMonth: row.dueMonth, amount: row.amount, months: 1, ids: [row.id] });
    }
  }
  return ranges;
}

/** "Dec 2026" for a single month, "Dec 2026 – Feb 2027" for a run. */
export function formatBillOverrideRange(range: Pick<BillOverrideRange, "fromMonth" | "toMonth">): string {
  return range.fromMonth === range.toMonth
    ? formatBillMonth(range.fromMonth)
    : `${formatBillMonth(range.fromMonth)} – ${formatBillMonth(range.toMonth)}`;
}

/**
 * The writes that make `billId` cost `amount` in each of `months`, as ONE
 * batch (lib/batch-api.ts → one transaction, so a three-month change is never
 * half saved).
 *
 * A bill has ONE temporary amount at a time (user decision, Nov 25 2026 — the
 * first build let several pile up on one bill): every row the bill has from
 * `fromMonth` (the current month) on is deleted first, whichever months it
 * covers, so the new run REPLACES whatever was set. Rows before `fromMonth`
 * are history — they keep past months showing what was planned — and are
 * never touched. When `amount` equals the bill's regular amount there is
 * nothing temporary about it, so the bill is only cleared — no no-op rows are
 * stored (the same rule as a paycheck saved at its regular amount).
 */
export function buildSetBillOverrideOperations(params: {
  billId: string;
  months: readonly number[];
  /** Dollars per payment; 0 = nothing is charged. */
  amount: number;
  /** The bill's regular amount (`Bill.amount`), dollars. */
  regularAmount: number;
  /** The current month (YYYYMM): the bill's rows from here on are replaced. */
  fromMonth: number;
  /** Every BillOverride row currently stored (any bill). */
  existing: readonly (BillOverrideLike & { id?: string | null })[];
}): BatchOperation[] {
  const { billId, months, amount, regularAmount, fromMonth, existing } = params;
  const operations: BatchOperation[] = [];
  for (const row of existing) {
    if (String(row.billId) !== String(billId) || !row.id) continue;
    const dueMonth = Number(row.dueMonth);
    if (!Number.isFinite(dueMonth) || dueMonth < fromMonth) continue;
    operations.push({ op: "delete", resource: "BillOverride", id: String(row.id) });
  }
  const isRegular = Math.round(amount * 100) === Math.round(regularAmount * 100);
  if (!isRegular) {
    for (const dueMonth of months) {
      operations.push({ op: "create", resource: "BillOverride", values: { billId, dueMonth, amount } });
    }
  }
  return operations;
}
