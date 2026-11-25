/**
 * Temporary bill amounts (Nov 25 2026) — "this bill is $50 for three months",
 * "nothing is charged for a few months".
 *
 * A BillOverride row replaces the amount of ONE bill for the payment due in
 * ONE calendar month. These tests pin the rule end to end on generic sample
 * data (a $180 "Car loan" due the 20th, $700 paychecks on Wednesdays):
 *   - the helpers every page shares (pay-period-utils): which month a payment
 *     belongs to, in whichever view it is looked at;
 *   - the balance (balancePayWeeks) and the planner (optimize-plan): the
 *     payment is planned at the temporary amount, $0 plans nothing, every
 *     other bill and month is untouched, a week that has already started is
 *     left alone, the bill is back at its regular amount afterwards and
 *     removing the rows restores the original plan;
 *   - what the screens read (getBillAllocationsForBill, the Plan's Auto-assign
 *     target and ⚠ evaluation): a $0 month shows and asks for $0;
 *   - the input signature (optimize-run): a temporary amount is an input
 *     change, and none at all means the signature older builds saved;
 *   - the editing helpers (bill-overrides): month arithmetic, readable
 *     ranges, and the batch of writes behind "Add".
 *
 * November 2026: Wednesdays on 4, 11, 18, 25. December 2026: 2, 9, 16, 23, 30.
 * January 2027: 6, 13, 20, 27.
 */
import { describe, it, expect } from "vitest";
import {
  balancePayWeeks,
  billAmountForMonth,
  billAmountsByCoord,
  billMonthKey,
  findBillOverride,
  formatBillMonth,
  getBillAllocationCentsForPeriod,
  getBillAllocationsForBill,
  getPayPeriodsForMonth,
  monthKeyOf,
  occurrenceDueMonth,
} from "./pay-period-utils";
import { planOptimize } from "./optimize-plan";
import { computeInputSignatures, describeInputChange } from "./optimize-run";
import { computeExpectedAssignedThroughPeriod, evaluatePlanSync, resolveAutoAssignAmountForPeriod } from "./budget-utils";
import {
  addBillMonths,
  billMonthsFrom,
  buildSetBillOverrideOperations,
  defaultOverrideStartMonth,
  formatBillOverrideRange,
  groupBillOverrideRanges,
} from "./bill-overrides";

const WED = 3;
const TODAY = new Date(2026, 10, 10, 12); // Tue Nov 10 2026 — pay week 1 (Nov 4) is running
const income = { id: "inc", name: "Paycheck", amount: 700, paymentCycle: "WEEKLY", payDay: WED, payWeekOffset: 0, isPrimary: true };

const novPeriods = getPayPeriodsForMonth(2026, 10, WED, TODAY, false);
const decPeriods = getPayPeriodsForMonth(2026, 11, WED, TODAY, false);
const NOV = monthKeyOf(2026, 10);
const DEC = monthKeyOf(2026, 11);
const JAN = monthKeyOf(2027, 0);
const FEB = monthKeyOf(2027, 1);

/** "The car loan is $50 in December and January." */
const LOAN_50 = [
  { id: "v1", billId: "loan", dueMonth: 202612, amount: 50 },
  { id: "v2", billId: "loan", dueMonth: 202701, amount: 50 },
];

describe("which month a payment belongs to", () => {
  it("billMonthKey is the calendar month as a YYYYMM number (month is 0-based like Date)", () => {
    expect(billMonthKey(2026, 11)).toBe(202612);
    expect(billMonthKey(2027, 0)).toBe(202701);
    // Month overflow / underflow rolls the year.
    expect(billMonthKey(2026, 12)).toBe(202701);
    expect(billMonthKey(2027, -1)).toBe(202612);
  });

  it("formatBillMonth reads as a month and a year", () => {
    expect(formatBillMonth(202612)).toBe("Dec 2026");
    expect(formatBillMonth(202701)).toBe("Jan 2027");
  });

  it("a coord inside the view's month is that month; past its end it is the next one", () => {
    // December has 31 days.
    expect(occurrenceDueMonth(2026, 11, 20)).toBe(202612);
    expect(occurrenceDueMonth(2026, 11, 31)).toBe(202612);
    // Coord 34 in December = Jan 3 (the forward extension) → January 2027.
    expect(occurrenceDueMonth(2026, 11, 34)).toBe(202701);
    // Coord 33 in a 30-day November = Dec 3 (a pre-save slice) → December.
    expect(occurrenceDueMonth(2026, 10, 33)).toBe(202612);
  });
});

describe("findBillOverride / billAmountForMonth", () => {
  it("finds the row for that bill and month only", () => {
    expect(findBillOverride(LOAN_50, "loan", 202612)).toBe(LOAN_50[0]);
    expect(findBillOverride(LOAN_50, "loan", 202611)).toBeNull();
    expect(findBillOverride(LOAN_50, "rent", 202612)).toBeNull();
    expect(findBillOverride([], "loan", 202612)).toBeNull();
    expect(findBillOverride(undefined, "loan", 202612)).toBeNull();
  });

  it("the month and the amount may arrive as strings", () => {
    expect(billAmountForMonth("loan", 180, 202612, [{ billId: "loan", dueMonth: "202612", amount: "50" }])).toBe(50);
  });

  it("$0 is a real amount: nothing is charged that month", () => {
    expect(billAmountForMonth("loan", 180, 202612, [{ billId: "loan", dueMonth: 202612, amount: 0 }])).toBe(0);
  });

  it("no row, or a row that cannot be read, is the regular amount", () => {
    expect(billAmountForMonth("loan", 180, 202611, LOAN_50)).toBe(180);
    for (const amount of [null, undefined, "", "abc", NaN, -5]) {
      expect(billAmountForMonth("loan", 180, 202612, [{ billId: "loan", dueMonth: 202612, amount: amount as any }]), String(amount)).toBe(180);
    }
  });
});

describe("billAmountsByCoord — what the balance is handed", () => {
  it("is undefined for a bill without temporary amounts, so the balance gets it exactly as before", () => {
    expect(billAmountsByCoord("loan", 20, decPeriods, 2026, 11, [])).toBeUndefined();
    expect(billAmountsByCoord("rent", 20, decPeriods, 2026, 11, LOAN_50)).toBeUndefined();
    // Has rows, but none for a payment of this view (November).
    expect(billAmountsByCoord("loan", 20, novPeriods, 2026, 10, LOAN_50)).toBeUndefined();
  });

  it("an in-month payment is keyed by its day", () => {
    expect(billAmountsByCoord("loan", 20, decPeriods, 2026, 11, LOAN_50)).toEqual({ 20: 50 });
  });

  it("a forward-extended payment takes the NEXT month's amount", () => {
    // A bill due the 3rd fires twice in the December view: Dec 3 (coord 3)
    // and Jan 3 (coord 34, in the pay week Dec 30 – Jan 5).
    const janOnly = [{ billId: "gym", dueMonth: 202701, amount: 10 }];
    expect(billAmountsByCoord("gym", 3, decPeriods, 2026, 11, janOnly)).toEqual({ 34: 10 });
    const decOnly = [{ billId: "gym", dueMonth: 202612, amount: 10 }];
    expect(billAmountsByCoord("gym", 3, decPeriods, 2026, 11, decOnly)).toEqual({ 3: 10 });
  });

  it("a payment saved ahead for next month's first pay week takes next month's amount too", () => {
    // Dec 3 is in December's FIRST pay week (Dec 2–8), so November may save
    // ahead for it: coord 3 + 30 days of November = 33.
    const decOnly = [{ billId: "gym", dueMonth: 202612, amount: 10 }];
    expect(billAmountsByCoord("gym", 3, novPeriods, 2026, 10, decOnly)).toEqual({ 33: 10 });
  });
});

describe("balancePayWeeks with a temporary amount", () => {
  const base = {
    periods: decPeriods,
    incomePerPeriodCents: decPeriods.map(() => 70000),
    fixedExpensesPerPeriodCents: decPeriods.map(() => 0),
    targetSurplusCents: 20000,
  };
  const loan = { id: "loan", amount: 180, dueDate: 20 };
  const total = (r: ReturnType<typeof balancePayWeeks>) => r.allocations.reduce((s, a) => s + a.amountCents, 0);

  it("plans the payment at the temporary amount", () => {
    const regular = balancePayWeeks({ ...base, bills: [loan] });
    const temporary = balancePayWeeks({ ...base, bills: [{ ...loan, amountByCoord: { 20: 50 } }] });
    expect(total(regular)).toBe(18000);
    expect(total(temporary)).toBe(5000);
    expect(temporary.underfunded).toEqual([]);
  });

  it("$0 plans nothing for that payment and is not an under-funded bill", () => {
    const free = balancePayWeeks({ ...base, bills: [{ ...loan, amountByCoord: { 20: 0 } }] });
    expect(free.allocations).toEqual([]);
    expect(free.underfunded).toEqual([]);
    expect(free.skipped).toEqual([]);
  });

  it("a coord that is not listed keeps the regular amount", () => {
    // The Dec 3 payment is temporary, the Jan 3 one (coord 34) is regular.
    const r = balancePayWeeks({ ...base, bills: [{ id: "gym", amount: 40, dueDate: 3, amountByCoord: { 3: 10 } }] });
    const byCoord = (coord: number) => r.allocations.filter((a) => a.occurrenceCoord === coord).reduce((s, a) => s + a.amountCents, 0);
    expect(byCoord(3)).toBe(1000);
    expect(byCoord(34)).toBe(4000);
  });

  it("rows already saved in started weeks are history: a lower amount plans nothing more", () => {
    // $100 of the loan sits in week 1, which has started (today = Dec 3).
    const r = balancePayWeeks({
      ...base,
      bills: [{ ...loan, amountByCoord: { 20: 50 } }],
      todayCoord: 3,
      lockedAllocations: [{ billId: "loan", weekIndex: 0, amountCents: 10000, occurrenceCoord: 20 }],
    });
    expect(r.allocations).toEqual([]);
    expect(r.underfunded).toEqual([]);
  });
});

describe("planOptimize with a temporary amount", () => {
  const TARGET = 20000; // $200 surplus per pay week
  const personals = [{ id: "p1", name: "Spending", amount: 100, repeatWeekly: true }];
  const bills = [
    { id: "gym", name: "Gym", amount: 40, dueDate: 3, neverSplit: false },
    { id: "internet", name: "Internet", amount: 60, dueDate: 12, neverSplit: false },
    { id: "phone", name: "Phone", amount: 80, dueDate: 19, neverSplit: false },
    { id: "loan", name: "Car loan", amount: 180, dueDate: 20, neverSplit: false },
    { id: "car", name: "Insurance", amount: 250, dueDate: 26, neverSplit: false },
    { id: "power", name: "Power", amount: 90, dueDate: 28, neverSplit: false },
  ];
  const inputs = (splitRows: any[], billOverrides: any[] = [], today = TODAY) => ({
    today,
    bills,
    billOverrides,
    personalBills: personals,
    incomes: [income],
    primaryIncome: income,
    splitRows,
    targetSurplusCents: TARGET,
    horizonMonths: 5, // Nov, Dec, Jan, Feb, Mar
  });
  /** The rows a database holds after `plans` are applied to `rows`. */
  const apply = (rows: any[], plans: ReturnType<typeof planOptimize>) => {
    let next = [...rows];
    let seq = rows.length;
    for (const p of plans) {
      const doomed = new Set(p.toDelete.map((r: any) => r.id));
      next = next.filter((r) => !doomed.has(r.id));
      for (const c of p.toCreate) next.push({ id: `n${seq++}`, monthKey: p.mk, ...c });
    }
    return next;
  };
  /** Rows as comparable strings (ids differ between runs). */
  const keys = (rows: any[], filter: (r: any) => boolean = () => true) =>
    rows
      .filter(filter)
      .map((r) => `${r.monthKey}|${r.billId}|${r.weekIndex}|${r.occurrenceCoord}|${r.amountCents}`)
      .sort();
  /** Cents planned for one payment: the rows of `mk` tagged with `coord`. */
  const planned = (rows: any[], mk: string, billId: string, coord: number) =>
    rows.filter((r) => r.monthKey === mk && r.billId === billId && r.occurrenceCoord === coord).reduce((s, r) => s + r.amountCents, 0);
  const rowCount = (rows: any[], mk: string, billId: string, coord: number) =>
    rows.filter((r) => r.monthKey === mk && r.billId === billId && r.occurrenceCoord === coord).length;

  const regular = apply([], planOptimize(inputs([])));
  const temporary = apply([], planOptimize(inputs([], LOAN_50)));

  it("without temporary amounts the loan is planned at $180 every month", () => {
    for (const mk of [DEC, JAN, FEB]) expect(planned(regular, mk, "loan", 20), mk).toBe(18000);
  });

  it("the months that have one are planned at $50 — and the month after is back at $180", () => {
    expect(planned(temporary, DEC, "loan", 20)).toBe(5000);
    expect(planned(temporary, JAN, "loan", 20)).toBe(5000);
    expect(planned(temporary, FEB, "loan", 20)).toBe(18000);
    expect(planned(temporary, monthKeyOf(2027, 2), "loan", 20)).toBe(18000);
  });

  it("every other payment is still funded in full, in every month", () => {
    for (const mk of [DEC, JAN, FEB]) {
      for (const [id, coord, cents] of [["internet", 12, 6000], ["phone", 19, 8000], ["car", 26, 25000], ["power", 28, 9000]] as const) {
        expect(planned(temporary, mk, id, coord), `${mk} ${id}`).toBe(cents);
      }
    }
  });

  it("only the months with a temporary amount change: November and February onwards are planned exactly as before", () => {
    const outside = (r: any) => r.monthKey !== DEC && r.monthKey !== JAN;
    expect(keys(temporary, outside)).toEqual(keys(regular, outside));
    expect(keys(temporary, (r) => r.monthKey === DEC)).not.toEqual(keys(regular, (r) => r.monthKey === DEC));
  });

  it("the freed money stays in the pay weeks: December's bills total $130 less", () => {
    const monthTotal = (rows: any[], mk: string) => rows.filter((r) => r.monthKey === mk).reduce((s, r) => s + r.amountCents, 0);
    // Pre-save slices for January's first week live in December's rows too,
    // but the loan (due the 20th) is never one of them.
    expect(monthTotal(regular, DEC) - monthTotal(temporary, DEC)).toBe(13000);
  });

  it("is idempotent once applied", () => {
    expect(planOptimize(inputs(temporary, LOAN_50))).toEqual([]);
  });

  it("removing the temporary amounts puts the original plan back", () => {
    const restored = apply(temporary, planOptimize(inputs(temporary, [])));
    expect(keys(restored)).toEqual(keys(regular));
  });

  it("$0 plans no rows at all for that payment, and nothing is reported as under-funded", () => {
    const free = [{ id: "v0", billId: "loan", dueMonth: 202612, amount: 0 }];
    // planOptimize throws on an under-funded occurrence; it must not here.
    const rows = apply([], planOptimize(inputs([], free)));
    expect(rowCount(rows, DEC, "loan", 20)).toBe(0);
    expect(planned(rows, JAN, "loan", 20)).toBe(18000);
    expect(planOptimize(inputs(rows, free))).toEqual([]);
    // Going from $50 to $0 removes the $50 rows.
    const from50 = apply(temporary, planOptimize(inputs(temporary, [...free, LOAN_50[1]])));
    expect(rowCount(from50, DEC, "loan", 20)).toBe(0);
    expect(planned(from50, JAN, "loan", 20)).toBe(5000);
  });

  it("a payment planned by the PREVIOUS month's view follows the month it is due in", () => {
    // The gym is due the 3rd. Its Jan 3 payment is planned in December's
    // view (coord 34, pay week Dec 30 – Jan 5); its Dec 3 payment in
    // December's first pay week (coord 3), plus whatever November saved
    // ahead for it (coord 33 in November's rows).
    const jan = [{ id: "g1", billId: "gym", dueMonth: 202701, amount: 10 }];
    const rows = apply([], planOptimize(inputs([], jan)));
    expect(planned(rows, DEC, "gym", 34)).toBe(1000); // Jan 3: temporary
    expect(planned(rows, DEC, "gym", 3) + planned(rows, NOV, "gym", 33)).toBe(4000); // Dec 3: regular
    // Feb 3 is regular again. It is February's own first pay week (Feb 3–9),
    // plus whatever January saved ahead for it (coord 34 = 3 + 31 there).
    expect(planned(rows, FEB, "gym", 3) + planned(rows, JAN, "gym", 34)).toBe(4000);

    const dec = [{ id: "g2", billId: "gym", dueMonth: 202612, amount: 10 }];
    const rows2 = apply([], planOptimize(inputs([], dec)));
    expect(planned(rows2, DEC, "gym", 3) + planned(rows2, NOV, "gym", 33)).toBe(1000); // Dec 3: temporary
    expect(planned(rows2, DEC, "gym", 34)).toBe(4000); // Jan 3: regular
  });

  it("a pay week that has already started keeps what it saved (its rows are history)", () => {
    // Nov 21: week 3 (Nov 18–24), which holds the loan's Nov 20 payment, has started.
    const nov21 = new Date(2026, 10, 21, 12);
    const startedWeeks = (r: any) => r.monthKey === NOV && r.weekIndex <= 2;
    const before = keys(regular, startedWeeks);
    const nov = [{ id: "v3", billId: "loan", dueMonth: 202611, amount: 50 }];
    const after = apply(regular, planOptimize(inputs(regular, nov, nov21)));
    expect(keys(after, startedWeeks)).toEqual(before);
    // The loan's $180 for Nov 20 is still there, not rewritten to $50.
    expect(planned(after, NOV, "loan", 20)).toBe(18000);
  });
});

describe("what the screens read (getBillAllocationsForBill)", () => {
  const rows50 = [{ billId: "loan", monthKey: DEC, weekIndex: 2, amountCents: 5000, occurrenceCoord: 20 }];

  it("without temporary amounts the result is exactly what it was (no extra field)", () => {
    const rows = [{ billId: "loan", monthKey: DEC, weekIndex: 2, amountCents: 18000, occurrenceCoord: 20 }];
    const before = getBillAllocationsForBill("loan", 20, 180, decPeriods, DEC, rows);
    expect(getBillAllocationsForBill("loan", 20, 180, decPeriods, DEC, rows, [])).toEqual(before);
    expect(getBillAllocationsForBill("loan", 20, 180, decPeriods, DEC, rows, undefined)).toEqual(before);
    // Rows of another bill, or of another month, change nothing either.
    expect(getBillAllocationsForBill("loan", 20, 180, decPeriods, DEC, rows, [{ billId: "rent", dueMonth: 202612, amount: 1 }])).toEqual(before);
    expect(getBillAllocationsForBill("loan", 20, 180, decPeriods, DEC, rows, [{ billId: "loan", dueMonth: 202703, amount: 1 }])).toEqual(before);
    expect(before[0]).not.toHaveProperty("temporaryAmountCents");
  });

  it("a payment with a temporary amount says so on its rows", () => {
    const [a] = getBillAllocationsForBill("loan", 20, 180, decPeriods, DEC, rows50, LOAN_50);
    expect(a).toMatchObject({ amountCents: 5000, periodKey: "P3", occurrenceCoord: 20, temporaryAmountCents: 5000 });
  });

  it("a $0 month with no rows shows $0 — never the regular amount", () => {
    const free = [{ billId: "loan", dueMonth: 202612, amount: 0 }];
    const allocs = getBillAllocationsForBill("loan", 20, 180, decPeriods, DEC, [], free);
    expect(allocs).toHaveLength(1);
    expect(allocs[0]).toMatchObject({ amountCents: 0, periodKey: "P3", isSplit: false, temporaryAmountCents: 0 });
    // Without the override rows the same call falls back to the full bill —
    // which is why every caller has to pass them.
    expect(getBillAllocationsForBill("loan", 20, 180, decPeriods, DEC, [])[0].amountCents).toBe(18000);
    // The per-week totals the Overview's cash-flow cards sum up agree.
    expect(getBillAllocationCentsForPeriod("loan", 20, 180, decPeriods, DEC, [], "P3", free)).toBe(0);
    expect(getBillAllocationCentsForPeriod("loan", 20, 180, decPeriods, DEC, [], "P3")).toBe(18000);
  });

  it("a temporary amount with no rows yet falls back to that amount, not the regular one", () => {
    const allocs = getBillAllocationsForBill("loan", 20, 180, decPeriods, DEC, [], LOAN_50);
    expect(allocs[0]).toMatchObject({ amountCents: 5000, temporaryAmountCents: 5000 });
  });

  it("in a view with two payments, each takes its own month's amount", () => {
    // The gym in December: Dec 3 (coord 3) and Jan 3 (coord 34). Only January is temporary.
    const jan = [{ billId: "gym", dueMonth: 202701, amount: 10 }];
    const allocs = getBillAllocationsForBill("gym", 3, 40, decPeriods, DEC, [], jan);
    const dec3 = allocs.find((a) => a.occurrenceCoord === 3)!;
    const jan3 = allocs.find((a) => a.occurrenceCoord === 34)!;
    expect(dec3.amountCents).toBe(4000);
    expect(dec3).not.toHaveProperty("temporaryAmountCents");
    expect(jan3).toMatchObject({ amountCents: 1000, temporaryAmountCents: 1000 });
  });
});

describe("the Plan page with a temporary amount", () => {
  const item = { id: "i1", sourceType: "BILL" as const, sourceBillId: "loan" };
  const bill = { id: "loan", amount: 180, dueDate: 20 };
  const rows50 = [{ billId: "loan", monthKey: DEC, weekIndex: 2, amountCents: 5000, occurrenceCoord: 20 }];
  const target = (periodKey: string, splits: any[], billOverrides: any[]) =>
    resolveAutoAssignAmountForPeriod({ item, periodKey, periods: decPeriods, bills: [bill], personals: [], splits, monthKey: DEC, billOverrides });
  const expectedThrough = (idx: number, splits: any[], billOverrides: any[]) =>
    computeExpectedAssignedThroughPeriod({ item, throughPeriodIdx: idx, periods: decPeriods, bills: [bill], personals: [], splits, monthKey: DEC, billOverrides });

  it("Auto-assign targets the temporary amount in the bill's pay week", () => {
    expect(target("P3", rows50, LOAN_50)).toBe(5000);
    expect(target("P2", rows50, LOAN_50)).toBe(0);
    expect(expectedThrough(4, rows50, LOAN_50)).toBe(5000);
  });

  it("a $0 month asks for nothing in any pay week, so the envelope is never out of sync", () => {
    const free = [{ billId: "loan", dueMonth: 202612, amount: 0 }];
    for (const p of decPeriods) expect(target(p.key, [], free), p.key).toBe(0);
    expect(expectedThrough(4, [], free)).toBe(0);
    // Without the rows the Plan would ask for the full $180 in week 3.
    expect(target("P3", [], [])).toBe(18000);

    const sync = evaluatePlanSync({
      sourceType: "BILL",
      expectedFullCents: expectedThrough(4, [], free),
      expectedPreviousFullCents: expectedThrough(3, [], free),
      graceActivityCents: 0,
      availableCents: 0,
      activityCents: 0,
      paydayPending: false,
    });
    expect(sync.inPlay).toBe(false);
    expect(sync.isUnderfunded).toBe(false);
    expect(sync.needsSync).toBe(false);
  });
});

describe("input signature (stale-plan check + automatic re-plan)", () => {
  const base = {
    bills: [{ id: "loan", amount: 180, dueDate: 20, neverSplit: false }],
    incomes: [income],
    personalBills: [],
    targetSurplusCents: 20000,
  };

  it("with no temporary amounts the bills signature is exactly what older builds saved", () => {
    expect(computeInputSignatures(base).bills).toBe("loan:180:20:0");
    expect(computeInputSignatures({ ...base, billOverrides: [] })).toEqual(computeInputSignatures(base));
  });

  it("adding, changing or removing one is a bills change", () => {
    const none = computeInputSignatures(base);
    const with50 = computeInputSignatures({ ...base, billOverrides: LOAN_50 });
    expect(with50.bills).toBe("loan:180:20:0|loan@202612:50,loan@202701:50");
    expect(describeInputChange(with50, none)).toBe("Bills were added or updated.");
    const changed = computeInputSignatures({ ...base, billOverrides: [{ ...LOAN_50[0], amount: 0 }, LOAN_50[1]] });
    expect(describeInputChange(changed, with50)).toBe("Bills were added or updated.");
    expect(describeInputChange(computeInputSignatures({ ...base, billOverrides: [] }), none)).toBeNull();
  });

  it("does not depend on row order", () => {
    expect(computeInputSignatures({ ...base, billOverrides: [LOAN_50[1], LOAN_50[0]] })).toEqual(
      computeInputSignatures({ ...base, billOverrides: LOAN_50 }),
    );
  });
});

describe("editing helpers (bill-overrides.ts)", () => {
  it("addBillMonths / billMonthsFrom cross the year end", () => {
    expect(addBillMonths(202612, 1)).toBe(202701);
    expect(addBillMonths(202701, -1)).toBe(202612);
    expect(addBillMonths(202611, 14)).toBe(202801);
    expect(billMonthsFrom(202611, 4)).toEqual([202611, 202612, 202701, 202702]);
    expect(billMonthsFrom(202611, 0)).toEqual([]);
  });

  it("the default start is this month while its payment is still ahead, else next month", () => {
    const nov25 = new Date(2026, 10, 25, 12);
    expect(defaultOverrideStartMonth(nov25, 26)).toBe(202611); // due tomorrow
    expect(defaultOverrideStartMonth(nov25, 25)).toBe(202611); // due today
    expect(defaultOverrideStartMonth(nov25, 5)).toBe(202612); // already due this month
    // Year end.
    expect(defaultOverrideStartMonth(new Date(2026, 11, 20, 12), 5)).toBe(202701);
    // A bill due the 31st is due on the last day of a shorter month.
    expect(defaultOverrideStartMonth(new Date(2027, 1, 28, 12), 31)).toBe(202702);
    // An unreadable due day counts as the 1st.
    expect(defaultOverrideStartMonth(nov25, NaN)).toBe(202612);
  });

  it("groups consecutive months with the same amount into one run, from the given month on", () => {
    const rows = [
      { id: "a", billId: "loan", dueMonth: 202610, amount: 50 }, // history: before `fromMonth`
      { id: "b", billId: "loan", dueMonth: 202612, amount: 50 },
      { id: "c", billId: "loan", dueMonth: 202701, amount: 50 },
      { id: "d", billId: "loan", dueMonth: 202702, amount: 0 }, // another amount → its own run
      { id: "e", billId: "loan", dueMonth: 202704, amount: 0 }, // a gap → its own run
      { id: "f", billId: "rent", dueMonth: 202612, amount: 1 }, // another bill
      { id: "g", billId: "loan", dueMonth: 202705, amount: "abc" }, // unreadable: skipped
    ];
    const ranges = groupBillOverrideRanges(rows, "loan", 202611);
    expect(ranges).toEqual([
      { fromMonth: 202612, toMonth: 202701, amount: 50, months: 2, ids: ["b", "c"] },
      { fromMonth: 202702, toMonth: 202702, amount: 0, months: 1, ids: ["d"] },
      { fromMonth: 202704, toMonth: 202704, amount: 0, months: 1, ids: ["e"] },
    ]);
    expect(ranges.map(formatBillOverrideRange)).toEqual(["Dec 2026 – Jan 2027", "Feb 2027", "Apr 2027"]);
    expect(groupBillOverrideRanges(undefined, "loan", 202611)).toEqual([]);
  });

  it("'Add' replaces what the months already hold, in one batch", () => {
    const existing = [
      { id: "a", billId: "loan", dueMonth: 202612, amount: 75 },
      { id: "b", billId: "rent", dueMonth: 202612, amount: 1 }, // another bill: untouched
      { id: "c", billId: "loan", dueMonth: 202703, amount: 75 }, // another month: untouched
    ];
    expect(buildSetBillOverrideOperations({ billId: "loan", months: [202612, 202701], amount: 50, regularAmount: 180, existing })).toEqual([
      { op: "delete", resource: "BillOverride", id: "a" },
      { op: "create", resource: "BillOverride", values: { billId: "loan", dueMonth: 202612, amount: 50 } },
      { op: "create", resource: "BillOverride", values: { billId: "loan", dueMonth: 202701, amount: 50 } },
    ]);
  });

  it("$0 is stored; the regular amount is not (those months are only cleared)", () => {
    const existing = [{ id: "a", billId: "loan", dueMonth: 202612, amount: 75 }];
    expect(buildSetBillOverrideOperations({ billId: "loan", months: [202612], amount: 0, regularAmount: 180, existing })).toEqual([
      { op: "delete", resource: "BillOverride", id: "a" },
      { op: "create", resource: "BillOverride", values: { billId: "loan", dueMonth: 202612, amount: 0 } },
    ]);
    expect(buildSetBillOverrideOperations({ billId: "loan", months: [202612, 202701], amount: 180, regularAmount: 180, existing })).toEqual([
      { op: "delete", resource: "BillOverride", id: "a" },
    ]);
    // Nothing stored and nothing to clear → no request at all.
    expect(buildSetBillOverrideOperations({ billId: "loan", months: [202701], amount: 180, regularAmount: 180, existing })).toEqual([]);
  });
});
