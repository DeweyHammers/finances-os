/**
 * Per-week income overrides (Nov 2026) — "my hours jump between 32 and 40".
 *
 * An IncomeOverride row replaces ONE paycheck of ONE income, found by the
 * payday's date. These tests pin the rule end to end on generic sample data
 * ($700 for 40 hours, paid on Wednesdays):
 *   - the helpers every page shares (pay-period-utils): only the pay week of
 *     that payday changes, in whichever month view it is looked at;
 *   - the list of upcoming paychecks the Income page edits;
 *   - the planner (optimize-plan): a short week gets fewer bill cents, every
 *     bill stays fully funded, other months are untouched, a week that has
 *     already started is left alone, and removing the override restores the
 *     original plan;
 *   - the input signature (optimize-run): an override is an input change,
 *     and no overrides means the signature older builds saved.
 *
 * November 2026: Wednesdays on 4, 11, 18, 25. December 2026: 2, 9, 16, 23, 30.
 */
import { describe, it, expect } from "vitest";
import {
  computeIncomePerPeriodCents,
  findIncomeOverride,
  getIncomePaymentsForPeriod,
  getPayPeriodsForMonth,
  listIncomePaychecks,
  monthKeyOf,
  payDateKey,
  payDateKeyOf,
} from "./pay-period-utils";
import { planOptimize } from "./optimize-plan";
import { computeInputSignatures, describeInputChange } from "./optimize-run";

const WED = 3;
const TODAY = new Date(2026, 10, 10, 12); // Tue Nov 10 2026 — pay week 1 (Nov 4) is running
const income = { id: "inc", name: "Paycheck", amount: 700, baseHours: 40, paymentCycle: "WEEKLY", payDay: WED, payWeekOffset: 0, isPrimary: true };
const DEFAULTS = { payDay: WED, paymentCycle: "WEEKLY" };
/** "The Nov 18 paycheck is 32 hours." */
const NOV18_SHORT = { id: "o1", incomeId: "inc", payDate: 20261118, amount: 560, hours: 32 };

const novPeriods = getPayPeriodsForMonth(2026, 10, WED, TODAY, false);
const decPeriods = getPayPeriodsForMonth(2026, 11, WED, TODAY, false);

describe("payDateKey", () => {
  it("is the calendar date as a YYYYMMDD number (month is 0-based like Date)", () => {
    expect(payDateKey(2026, 10, 18)).toBe(20261118);
    expect(payDateKey(2027, 0, 6)).toBe(20270106);
    expect(payDateKeyOf(new Date(2026, 10, 18, 23, 59))).toBe(20261118);
  });
});

describe("income per pay week with an override", () => {
  it("changes only the pay week of that payday", () => {
    expect(novPeriods.map((p) => p.startDay)).toEqual([4, 11, 18, 25]);
    expect(computeIncomePerPeriodCents([income], novPeriods, 2026, 10, DEFAULTS)).toEqual([70000, 70000, 70000, 70000]);
    expect(computeIncomePerPeriodCents([income], novPeriods, 2026, 10, DEFAULTS, [NOV18_SHORT])).toEqual([70000, 70000, 56000, 70000]);
  });

  it("is that one week, not every week 3: December is untouched", () => {
    expect(computeIncomePerPeriodCents([income], decPeriods, 2026, 11, DEFAULTS, [NOV18_SHORT])).toEqual([70000, 70000, 70000, 70000, 70000]);
  });

  it("an override on a December payday shows up in December's view, where that payday belongs", () => {
    const dec2 = { incomeId: "inc", payDate: 20261202, amount: 525 };
    // Nov's last week runs Nov 25 – Dec 1; Dec 2 is December's first payday.
    expect(computeIncomePerPeriodCents([income], novPeriods, 2026, 10, DEFAULTS, [dec2])).toEqual([70000, 70000, 70000, 70000]);
    expect(computeIncomePerPeriodCents([income], decPeriods, 2026, 11, DEFAULTS, [dec2])[0]).toBe(52500);
  });

  it("belongs to one income; $0 means no paycheck; unreadable amounts are ignored", () => {
    const second = { id: "inc2", name: "Side job", amount: 150, paymentCycle: "WEEKLY", payDay: WED };
    const both = [income, second];
    expect(computeIncomePerPeriodCents(both, novPeriods, 2026, 10, DEFAULTS, [NOV18_SHORT])).toEqual([85000, 85000, 71000, 85000]);
    // A week off without pay.
    expect(computeIncomePerPeriodCents([income], novPeriods, 2026, 10, DEFAULTS, [{ ...NOV18_SHORT, amount: 0 }])[2]).toBe(0);
    // Junk never zeroes a paycheck by accident.
    for (const amount of [null, undefined, "abc"]) {
      expect(computeIncomePerPeriodCents([income], novPeriods, 2026, 10, DEFAULTS, [{ ...NOV18_SHORT, amount }])[2]).toBe(70000);
    }
    // A source without an id (the legacy AppSettings fallback) has no overrides.
    const { id: _id, ...noId } = income;
    expect(computeIncomePerPeriodCents([noId], novPeriods, 2026, 10, DEFAULTS, [NOV18_SHORT])[2]).toBe(70000);
    // Amounts and keys arrive loose off the REST boundary.
    expect(computeIncomePerPeriodCents([income], novPeriods, 2026, 10, DEFAULTS, [{ incomeId: "inc", payDate: "20261118", amount: "560.50" }])[2]).toBe(56050);
  });

  it("getIncomePaymentsForPeriod says which paycheck was overridden", () => {
    const [regular] = getIncomePaymentsForPeriod([income], novPeriods[1], 2026, 10, DEFAULTS, [NOV18_SHORT]);
    expect(regular).toEqual({ source: income, amount: 700, payDate: 20261111, override: null });
    const [short] = getIncomePaymentsForPeriod([income], novPeriods[2], 2026, 10, DEFAULTS, [NOV18_SHORT]);
    expect(short).toEqual({ source: income, amount: 560, payDate: 20261118, override: NOV18_SHORT });
    expect(findIncomeOverride([NOV18_SHORT], "inc", 20261118)).toBe(NOV18_SHORT);
    expect(findIncomeOverride([NOV18_SHORT], "inc", 20261125)).toBeNull();
  });

  it("a weekly income on a bi-weekly grid: the overridden payday inside the period decides", () => {
    // Bi-weekly periods (Nov 4–17, Nov 18–Dec 1); the weekly income pays twice
    // in each but counts once. An override on the SECOND payday still applies.
    const biPeriods = getPayPeriodsForMonth(2026, 10, WED, TODAY, true);
    expect(biPeriods.map((p) => p.startDay)).toEqual([4, 18]);
    const nov25 = { incomeId: "inc", payDate: 20261125, amount: 560 };
    expect(computeIncomePerPeriodCents([income], biPeriods, 2026, 10, DEFAULTS, [nov25])).toEqual([70000, 56000]);
  });
});

describe("listIncomePaychecks — the weeks the Income page lets you edit", () => {
  const label = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

  it("32 hours worked Nov 11–17 belong to the Nov 18 paycheck (pay week Nov 18–24)", () => {
    const list = listIncomePaychecks(income, DEFAULTS, TODAY, 6);
    const forThatWorkWeek = list.find((p) => label(p.workStart) === "11/11" && label(p.workEnd) === "11/17")!;
    expect(forThatWorkWeek.payDate).toBe(NOV18_SHORT.payDate);
    expect(`${label(forThatWorkWeek.start)}-${label(forThatWorkWeek.end)}`).toBe("11/18-11/24");
  });

  it("starts at the pay week covering today and runs forward, each with its date range", () => {
    const list = listIncomePaychecks(income, DEFAULTS, TODAY, 6);
    expect(list.map((p) => `${label(p.start)}-${label(p.end)}`)).toEqual([
      "11/4-11/10",
      "11/11-11/17",
      "11/18-11/24",
      "11/25-12/1",
      "12/2-12/8",
      "12/9-12/15",
    ]);
    expect(list.map((p) => p.isCurrent)).toEqual([true, false, false, false, false, false]);
    expect(list.map((p) => p.weekOfMonth)).toEqual([1, 2, 3, 4, 1, 2]);
    // Pay is a period in arrears: each paycheck is for the hours worked in
    // the pay period just before its payday.
    expect(list.map((p) => `${label(p.workStart)}-${label(p.workEnd)}`)).toEqual([
      "10/28-11/3",
      "11/4-11/10",
      "11/11-11/17",
      "11/18-11/24",
      "11/25-12/1",
      "12/2-12/8",
    ]);
    // The key an override is saved under is the key the planner looks up.
    expect(list[2].payDate).toBe(NOV18_SHORT.payDate);
  });

  it("on a payday, that paycheck is the current one", () => {
    const list = listIncomePaychecks(income, DEFAULTS, new Date(2026, 10, 18, 8), 2);
    expect(list[0]).toMatchObject({ payDate: 20261118, isCurrent: true, weekOfMonth: 3 });
  });

  it("crosses the year end", () => {
    const list = listIncomePaychecks(income, DEFAULTS, new Date(2026, 11, 29), 3);
    expect(list.map((p) => p.payDate)).toEqual([20261223, 20261230, 20270106]);
  });

  it("follows a bi-weekly income's own paydays (every other payday of each month)", () => {
    const biWeekly = { ...income, paymentCycle: "BI_WEEKLY", payWeekOffset: 0 };
    // Nov: 4, 18 · Dec: 2, 16, 30 · Jan 2027: 6
    const list = listIncomePaychecks(biWeekly, DEFAULTS, TODAY, 5);
    expect(list.map((p) => p.payDate)).toEqual([20261104, 20261118, 20261202, 20261216, 20261230]);
    expect(`${label(list[0].start)}-${label(list[0].end)}`).toBe("11/4-11/17");
    // …and each is for the two weeks before its payday.
    expect(`${label(list[1].workStart)}-${label(list[1].workEnd)}`).toBe("11/4-11/17");
    // Dec 30 → Jan 6: the month-based rule makes that gap one week.
    expect(`${label(list[4].start)}-${label(list[4].end)}`).toBe("12/30-1/5");
  });

  it("returns exactly the number asked for, however many", () => {
    expect(listIncomePaychecks(income, DEFAULTS, TODAY, 1)).toHaveLength(1);
    expect(listIncomePaychecks(income, DEFAULTS, TODAY, 40)).toHaveLength(40);
  });
});

describe("planOptimize with a short week", () => {
  const TARGET = 20000; // $200 surplus per pay week
  const NOV = monthKeyOf(2026, 10);
  const personals = [{ id: "p1", name: "Spending", amount: 100, repeatWeekly: true }];
  // None due Dec 2–8, so no bill is pre-saved from November into December and
  // the two months stay independent of each other.
  const bills = [
    { id: "internet", name: "Internet", amount: 60, dueDate: 12, neverSplit: false },
    { id: "phone", name: "Phone", amount: 80, dueDate: 19, neverSplit: false },
    { id: "rent", name: "Rent", amount: 300, dueDate: 20, neverSplit: false },
    { id: "car", name: "Car", amount: 250, dueDate: 26, neverSplit: false },
    { id: "power", name: "Power", amount: 90, dueDate: 28, neverSplit: false },
  ];
  const inputs = (splitRows: any[], incomeOverrides: any[] = [], today = TODAY) => ({
    today,
    bills,
    personalBills: personals,
    incomes: [income],
    incomeOverrides,
    primaryIncome: income,
    splitRows,
    targetSurplusCents: TARGET,
    horizonMonths: 3, // Nov, Dec, Jan
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
  const keys = (rows: any[], mk?: string) =>
    rows
      .filter((r) => !mk || r.monthKey === mk)
      .map((r) => `${r.monthKey}|${r.billId}|${r.weekIndex}|${r.occurrenceCoord}|${r.amountCents}`)
      .sort();
  const billCentsPerWeek = (rows: any[], mk: string, weeks: number) =>
    Array.from({ length: weeks }, (_, w) =>
      rows.filter((r) => r.monthKey === mk && r.weekIndex === w).reduce((s, r) => s + r.amountCents, 0),
    );
  const fundedCents = (rows: any[], mk: string, billId: string) =>
    rows.filter((r) => r.monthKey === mk && r.billId === billId).reduce((s, r) => s + r.amountCents, 0);

  const regular = apply([], planOptimize(inputs([])));
  const short = apply([], planOptimize(inputs([], [NOV18_SHORT])));

  it("without an override, week 3 carries Phone + Rent ($380) on a $700 paycheck", () => {
    expect(billCentsPerWeek(regular, NOV, 4)[2]).toBe(38000);
  });

  it("the short week gets fewer bills, so its surplus still meets the target", () => {
    const perWeek = billCentsPerWeek(short, NOV, 4);
    // $560 − $100 spending − $200 target leaves $260 for bills in week 3.
    expect(perWeek[2]).toBeLessThanOrEqual(26000);
    expect(56000 - 10000 - perWeek[2]).toBeGreaterThanOrEqual(TARGET);
    // The cents that left week 3 went to other weeks that have not started…
    expect(perWeek[1] + perWeek[3]).toBeGreaterThan(billCentsPerWeek(regular, NOV, 4)[1] + billCentsPerWeek(regular, NOV, 4)[3]);
    // …never into week 1, which is already running (locked).
    expect(perWeek[0]).toBe(billCentsPerWeek(regular, NOV, 4)[0]);
  });

  it("every bill is still funded in full", () => {
    for (const b of bills) {
      expect(fundedCents(short, NOV, b.id), b.id).toBe(Math.round(b.amount * 100));
      expect(fundedCents(regular, NOV, b.id), b.id).toBe(Math.round(b.amount * 100));
    }
  });

  it("only November changes: December and January are planned exactly as before", () => {
    expect(keys(short, monthKeyOf(2026, 11))).toEqual(keys(regular, monthKeyOf(2026, 11)));
    expect(keys(short, monthKeyOf(2027, 0))).toEqual(keys(regular, monthKeyOf(2027, 0)));
    expect(keys(short, NOV)).not.toEqual(keys(regular, NOV));
  });

  it("is idempotent once applied", () => {
    expect(planOptimize(inputs(short, [NOV18_SHORT]))).toEqual([]);
  });

  it("removing the override puts the original plan back", () => {
    const restored = apply(short, planOptimize(inputs(short, [])));
    expect(keys(restored)).toEqual(keys(regular));
  });

  it("changing an override's amount re-plans that week again", () => {
    const shorter = apply(short, planOptimize(inputs(short, [{ ...NOV18_SHORT, amount: 420, hours: 24 }])));
    const perWeek = billCentsPerWeek(shorter, NOV, 4);
    // $420 − $100 − $200 leaves $120 for bills.
    expect(perWeek[2]).toBeLessThanOrEqual(12000);
    for (const b of bills) expect(fundedCents(shorter, NOV, b.id), b.id).toBe(Math.round(b.amount * 100));
  });

  it("an override on the week that has already started changes no bill rows (its paycheck is handed out)", () => {
    const current = { incomeId: "inc", payDate: 20261104, amount: 560, hours: 32 };
    expect(keys(apply([], planOptimize(inputs([], [current]))))).toEqual(keys(regular));
    expect(planOptimize(inputs(regular, [current]))).toEqual([]);
  });

  it("once the short week has started, its rows are history even if the override is edited", () => {
    const nov19 = new Date(2026, 10, 19, 12);
    const before = keys(short, NOV);
    // Planned with the short week; on Nov 19 the override is removed.
    const after = apply(short, planOptimize(inputs(short, [], nov19)));
    const lockedWeeks = (ks: string[]) => ks.filter((k) => Number(k.split("|")[2]) <= 2);
    expect(lockedWeeks(keys(after, NOV))).toEqual(lockedWeeks(before));
  });
});

describe("input signature (stale-plan check + automatic re-plan)", () => {
  const base = { bills: [], incomes: [income], personalBills: [], targetSurplusCents: 30000 };

  it("no overrides → exactly the signature older builds saved (the upgrade itself re-plans nothing)", () => {
    expect(computeInputSignatures(base).incomes).toBe("inc:700:3:WEEKLY:0");
    expect(computeInputSignatures({ ...base, incomeOverrides: [] })).toEqual(computeInputSignatures(base));
  });

  it("adding, changing or removing an override is an income change; hours alone are not", () => {
    const none = computeInputSignatures(base);
    const withShort = computeInputSignatures({ ...base, incomeOverrides: [NOV18_SHORT] });
    expect(withShort.incomes).toBe("inc:700:3:WEEKLY:0|inc@20261118:560");
    expect(describeInputChange(withShort, none)).toBe("Income was added or updated.");
    const changed = computeInputSignatures({ ...base, incomeOverrides: [{ ...NOV18_SHORT, amount: 525 }] });
    expect(describeInputChange(changed, withShort)).toBe("Income was added or updated.");
    // Hours are a label; only the amount is planned on.
    const relabelled = computeInputSignatures({ ...base, incomeOverrides: [{ ...NOV18_SHORT, hours: 30 }] });
    expect(describeInputChange(relabelled, withShort)).toBeNull();
    // Row order does not matter.
    const dec = { incomeId: "inc", payDate: 20261202, amount: 600 };
    expect(computeInputSignatures({ ...base, incomeOverrides: [dec, NOV18_SHORT] })).toEqual(
      computeInputSignatures({ ...base, incomeOverrides: [NOV18_SHORT, dec] }),
    );
  });
});
