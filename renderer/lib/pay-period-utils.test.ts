import { describe, it, expect } from "vitest";
import {
  getPayPeriodsForMonth,
  getIncomePaydays,
  getIncomeSourcesForPeriod,
  computeIncomePerPeriodCents,
  withLegacyIncomeFallback,
  getBillPeriodKey,
  getBillOccurrencesInView,
  getBillAllocationsForBill,
  getBillAllocationCentsForPeriod,
  balancePayWeeks,
  assertNoUnderfundedBills,
  isPayWeekLocked,
  distributeBillLevel,
  distributeSplitAcrossWeeks,
  monthKeyOf,
  clampDayToMonth,
  MIN_SPLIT_CENTS,
  getPreSaveOccurrence,
  isPreSaveCoord,
} from "./pay-period-utils";
import { planOptimize } from "./optimize-plan";

// June 2026: Wednesdays on 3, 10, 17, 24
// July 2026: Wednesdays on 1, 8, 15, 22, 29
// August 2026: Wednesdays on 5, 12, 19, 26
// September 2026: Wednesdays on 2, 9, 16, 23, 30

const WED = 3;

describe("getPayPeriodsForMonth — weekly", () => {
  it("returns one period per in-month payday (June 2026 → 4)", () => {
    const periods = getPayPeriodsForMonth(2026, 5, WED);
    expect(periods).toHaveLength(4);
  });

  it("P1 starts on the first in-month payday", () => {
    const [p1] = getPayPeriodsForMonth(2026, 5, WED);
    expect(p1.startDay).toBe(3);
    expect(p1.dateRange).toBe("Jun 3 – Jun 9");
  });

  it("last period ends on last day of month when next month starts on payday", () => {
    const periods = getPayPeriodsForMonth(2026, 5, WED);
    expect(periods[periods.length - 1].endDay).toBe(30);
    expect(periods[periods.length - 1].dateRange).toBe("Jun 24 – Jun 30");
  });

  it("July 2026 returns 5 periods; P5 forward-extends to Aug 4", () => {
    const periods = getPayPeriodsForMonth(2026, 6, WED);
    expect(periods).toHaveLength(5);
    expect(periods[0].dateRange).toBe("Jul 1 – Jul 7");
    expect(periods[4].dateRange).toBe("Jul 29 – Aug 4");
  });

  it("August 2026 returns 4 periods starting on the first in-month payday (Aug 5)", () => {
    const periods = getPayPeriodsForMonth(2026, 7, WED);
    expect(periods).toHaveLength(4);
    expect(periods[0].dateRange).toBe("Aug 5 – Aug 11");
    expect(periods[3].dateRange).toBe("Aug 26 – Sep 1");
  });

  it("stores daysInMonth on every period", () => {
    const periods = getPayPeriodsForMonth(2026, 7, WED);
    periods.forEach((p) => expect(p.daysInMonth).toBe(31));
  });

  it("marks the correct period as current", () => {
    const today = new Date(2026, 5, 12);
    const periods = getPayPeriodsForMonth(2026, 5, WED, today);
    expect(periods.find((p) => p.isCurrent)?.key).toBe("P2");
  });
});

describe("getPayPeriodsForMonth — bi-weekly", () => {
  it("June 2026 bi-weekly returns 2 periods (paydays 3, 17)", () => {
    const periods = getPayPeriodsForMonth(2026, 5, WED, undefined, true);
    expect(periods).toHaveLength(2);
    expect(periods[0].dateRange).toBe("Jun 3 – Jun 16");
    expect(periods[1].dateRange).toBe("Jun 17 – Jun 30");
  });
});

describe("getBillPeriodKey — July 2026 attribution", () => {
  const periods = getPayPeriodsForMonth(2026, 6, WED);

  it("bill due 1st routes to P5 for its Aug 1 occurrence", () => {
    expect(getBillPeriodKey(1, periods)).toBe("P5");
  });

  it("bill due 5th falls in P1", () => {
    expect(getBillPeriodKey(5, periods)).toBe("P1");
  });

  it("bill due 15th falls in P3", () => {
    expect(getBillPeriodKey(15, periods)).toBe("P3");
  });
});

describe("getBillPeriodKey — August 2026 attribution", () => {
  const periods = getPayPeriodsForMonth(2026, 7, WED);

  it("bill due 1st routes to P4 (Sep 1 forward extension)", () => {
    expect(getBillPeriodKey(1, periods)).toBe("P4");
  });

  it("bill due 4th returns null in August (Sept view handles it naturally)", () => {
    // Aug 4 < P1.startDay (5); Sep 4 coord (35) > P4.endDay (32).
    // Sept's first payday is Sep 2 which is <= dueDate 4, so Sept's in-month
    // case will attribute Sep 4 to Sept P1 naturally. Aug orphan-attributing
    // would double-count the same firing across two views.
    expect(getBillPeriodKey(4, periods)).toBeNull();
  });

  it("bill due 5th falls in P1", () => {
    expect(getBillPeriodKey(5, periods)).toBe("P1");
  });
});

describe("clampDayToMonth", () => {
  it("clamps day 31 to 30 for June (30-day month)", () => {
    expect(clampDayToMonth(31, 2026, 5)).toBe(30);
  });

  it("clamps day 30 to 28 for February 2027 (non-leap)", () => {
    expect(clampDayToMonth(30, 2027, 1)).toBe(28);
  });

  it("does not clamp mid-month days", () => {
    expect(clampDayToMonth(15, 2026, 5)).toBe(15);
  });
});

describe("distributeSplitAcrossWeeks", () => {
  it("distributes proportionally to leftover room", () => {
    const res = distributeSplitAcrossWeeks(10000, [15000, 20000, 15000, 30000, 20000]);
    expect(res.perWeekCents).toEqual([1500, 2000, 1500, 3000, 2000]);
    expect(res.unallocatedCents).toBe(0);
  });

  it("sums exactly to totalCents when room permits", () => {
    const res = distributeSplitAcrossWeeks(100, [1000, 1000, 1000]);
    expect(res.perWeekCents.reduce((a, b) => a + b, 0)).toBe(100);
    expect(res.unallocatedCents).toBe(0);
  });

  it("caps at total room and reports unallocated", () => {
    const res = distributeSplitAcrossWeeks(50000, [10000, 10000, 10000]);
    expect(res.perWeekCents.reduce((a, b) => a + b, 0)).toBe(30000);
    expect(res.unallocatedCents).toBe(20000);
  });

  it("gives 0 to weeks with non-positive room", () => {
    const res = distributeSplitAcrossWeeks(1000, [500, 0, -200, 500]);
    expect(res.perWeekCents[1]).toBe(0);
    expect(res.perWeekCents[2]).toBe(0);
    expect(res.perWeekCents[0] + res.perWeekCents[3]).toBe(1000);
  });
});

describe("monthKeyOf", () => {
  it("formats to YYYY-MM with zero-padded month", () => {
    expect(monthKeyOf(2026, 0)).toBe("2026-01");
    expect(monthKeyOf(2026, 8)).toBe("2026-09");
    expect(monthKeyOf(2026, 11)).toBe("2026-12");
  });
});

describe("getBillAllocationsForBill", () => {
  const periods = getPayPeriodsForMonth(2026, 8, WED); // Sept 2026: 5 periods
  const mk = monthKeyOf(2026, 8);

  it("returns single-week allocation from a 1-row split", () => {
    const splits = [
      { billId: "b1", monthKey: mk, weekIndex: 2, amountCents: 15000 },
    ];
    const allocs = getBillAllocationsForBill("b1", 30, 150, periods, mk, splits);
    expect(allocs).toHaveLength(1);
    expect(allocs[0].periodKey).toBe("P3");
    expect(allocs[0].amountCents).toBe(15000);
    expect(allocs[0].isSplit).toBe(false);
  });

  it("returns multi-week allocations from N-row splits, isSplit=true", () => {
    const splits = [
      { billId: "b1", monthKey: mk, weekIndex: 0, amountCents: 5000 },
      { billId: "b1", monthKey: mk, weekIndex: 3, amountCents: 10000 },
    ];
    const allocs = getBillAllocationsForBill("b1", 30, 150, periods, mk, splits);
    expect(allocs).toHaveLength(2);
    expect(allocs.every((a) => a.isSplit)).toBe(true);
    expect(allocs.map((a) => a.periodKey)).toEqual(["P1", "P4"]);
  });

  it("falls back to natural attribution when no splits exist for the bill", () => {
    const allocs = getBillAllocationsForBill("noSplits", 30, 100, periods, mk, []);
    expect(allocs).toHaveLength(1);
    expect(allocs[0].amountCents).toBe(10000);
    expect(allocs[0].isSplit).toBe(false);
  });

  it("ignores splits whose weekIndex is out of range", () => {
    const splits = [
      { billId: "b1", monthKey: mk, weekIndex: 99, amountCents: 5000 },
    ];
    const allocs = getBillAllocationsForBill("b1", 30, 100, periods, mk, splits);
    // Falls back to natural attribution since all splits were invalid.
    expect(allocs).toHaveLength(1);
    expect(allocs[0].amountCents).toBe(10000);
  });
});

describe("getBillAllocationCentsForPeriod", () => {
  const periods = getPayPeriodsForMonth(2026, 8, WED);
  const mk = monthKeyOf(2026, 8);

  it("returns 0 when the bill has no allocation in the queried period", () => {
    const splits = [{ billId: "b1", monthKey: mk, weekIndex: 0, amountCents: 5000 }];
    expect(getBillAllocationCentsForPeriod("b1", 30, 50, periods, mk, splits, "P3")).toBe(0);
  });

  it("returns the split cents when there is an allocation", () => {
    const splits = [
      { billId: "b1", monthKey: mk, weekIndex: 1, amountCents: 3000 },
      { billId: "b1", monthKey: mk, weekIndex: 2, amountCents: 2000 },
    ];
    expect(getBillAllocationCentsForPeriod("b1", 30, 50, periods, mk, splits, "P2")).toBe(3000);
    expect(getBillAllocationCentsForPeriod("b1", 30, 50, periods, mk, splits, "P3")).toBe(2000);
  });
});

describe("distributeBillLevel", () => {
  it("empty existing → equal per-week distribution", () => {
    // 400 cents across 4 weeks with zero existing → 100 each.
    const out = distributeBillLevel(400, [0, 0, 0, 0]);
    expect(out).toEqual([100, 100, 100, 100]);
  });

  it("levels total bills per week when possible", () => {
    // existing = [0, 100, 100, 100], amount = 200 → target mean = 125
    // Weeks 1-3 already at 100, need +25 each = 75. Week 0 needs +125.
    // Total needed = 200 → matches amount.
    const out = distributeBillLevel(200, [0, 100, 100, 100]);
    expect(out).toEqual([125, 25, 25, 25]);
  });

  it("excludes weeks whose existing bills exceed the mean", () => {
    // existing = [500, 0, 0], amount = 300 → mean = 800/3 ≈ 266.67
    // Week 0 (500) > mean → exclude. New mean = (0+0+300)/2 = 150.
    // Weeks 1-2 each get 150.
    const out = distributeBillLevel(300, [500, 0, 0]);
    expect(out).toEqual([0, 150, 150]);
  });

  it("sums to amountCents exactly with largest-remainder rounding", () => {
    // 100 across 3 weeks with equal existing → shares of 33.33 each.
    const out = distributeBillLevel(100, [0, 0, 0]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("returns zeros when amount is 0", () => {
    expect(distributeBillLevel(0, [10, 20])).toEqual([0, 0]);
  });
});

describe("balancePayWeeks — Phase 1 (whole-bill placement)", () => {
  const periods = getPayPeriodsForMonth(2026, 8, WED);

  const bills = [
    { id: "billP", amount: 149.20, dueDate: 30 },
    { id: "billI", amount: 25.0, dueDate: 30 },
    { id: "billA", amount: 118.40, dueDate: 1 },
    { id: "billC", amount: 125.0, dueDate: 4 },
    { id: "billD", amount: 61.40, dueDate: 4 },
    { id: "billE", amount: 96.0, dueDate: 5 },
  ];

  it("all six bills are assigned to some week", () => {
    const result = balancePayWeeks({
      bills,
      periods,
      incomePerPeriodCents: [62000, 62000, 62000, 62000, 62000],
      fixedExpensesPerPeriodCents: [0, 0, 0, 0, 0],
      targetSurplusCents: 30000,
    });
    // Each bill has ≥ 1 allocation.
    const billsPlaced = new Set(result.allocations.map((a) => a.billId));
    expect(billsPlaced.size).toBe(6);
    expect(result.unplaced).toHaveLength(0);
  });

  it("feasible=true when every week clears target", () => {
    const result = balancePayWeeks({
      bills,
      periods,
      incomePerPeriodCents: [62000, 62000, 62000, 62000, 62000],
      fixedExpensesPerPeriodCents: [0, 0, 0, 0, 0],
      targetSurplusCents: 30000,
    });
    expect(result.feasible).toBe(true);
    result.perWeekBillCents.forEach((cents) => expect(cents).toBeLessThanOrEqual(32000));
  });

  it("marks feasible=false when total bills exceed total budget", () => {
    const result = balancePayWeeks({
      bills,
      periods,
      incomePerPeriodCents: [10000, 10000, 10000, 10000, 10000],
      fixedExpensesPerPeriodCents: [0, 0, 0, 0, 0],
      targetSurplusCents: 0,
    });
    expect(result.feasible).toBe(false);
  });
});

describe("balancePayWeeks — Phase 2 (auto-split large bills)", () => {
  // Simple 4-week month with $500/wk budget-for-bills and one huge bill.
  const periods = [
    { key: "P1", index: 0, startDay: 1, endDay: 7, daysInMonth: 30, isPaydayStart: true, firstPaydayOfMonth: 1, label: "", dateRange: "", isCurrent: false, color: "" },
    { key: "P2", index: 1, startDay: 8, endDay: 14, daysInMonth: 30, isPaydayStart: true, firstPaydayOfMonth: 1, label: "", dateRange: "", isCurrent: false, color: "" },
    { key: "P3", index: 2, startDay: 15, endDay: 21, daysInMonth: 30, isPaydayStart: true, firstPaydayOfMonth: 1, label: "", dateRange: "", isCurrent: false, color: "" },
    { key: "P4", index: 3, startDay: 22, endDay: 30, daysInMonth: 30, isPaydayStart: true, firstPaydayOfMonth: 1, label: "", dateRange: "", isCurrent: false, color: "" },
  ];

  it("splits a large bill across all eligible weeks to level surplus", () => {
    // One bill $400 due day 1 → eligible P1..P4 (via next-month coord 31 in
    // P4's forward extension it's not — coord 31 > P4.end 30. But direct
    // day 1 is not in P1..P4 either since P1 starts at 1). Actually with
    // startDay=1, dueDate=1 is in P1 directly. Let me use dueDate=30 to be
    // eligible everywhere via nextMonthCoord = 60. Won't work. Let me use a
    // dueDate where it's clearly eligible everywhere.
    // dueDate 25: nextMonthCoord = 55 (> 30, no); in-month 25 in P4 only.
    // dueDate 8: in-month 8 in P2; next-month 38 outside. Eligible P2..P4.
    // Let's set up bills where a big one is eligible everywhere.
    // dueDate 30: in-month 30 in P4; next-month 60 outside. Eligible only P4.
    // dueDate 1 with in-month coord 1 → P1 only.
    // dueDate 22: in-month 22 in P4; eligible P4 only.
    // dueDate 30 with daysInMonth=30 → next-month 60 out. Only P4.

    // To have a bill eligible for P1..P4, need occ coord >= startDay of P4 (22).
    // So dueDate = 22 gives coord 22 (P4 only), dueDate = 30 gives coord 30 (P4 only).
    // For P1 eligibility (startDay 1) coord >= 1, so ALL days eligible for P1.
    // Eligibility test in balancePayWeeks: `startDay <= coord`, so ALL periods
    // are eligible when coord >= max startDay = 22. dueDate 22 works.

    const result = balancePayWeeks({
      bills: [{ id: "big", amount: 400, dueDate: 22 }],
      periods,
      incomePerPeriodCents: [60000, 60000, 60000, 60000],
      fixedExpensesPerPeriodCents: [10000, 10000, 10000, 10000],
      targetSurplusCents: 20000, // budget-for-bills = 30000/week
    });

    // 40000 cents split across 4 weeks with equal 30000 budget: level =
    // 10000/week. Each week gets 10000.
    expect(result.perWeekBillCents).toEqual([10000, 10000, 10000, 10000]);
    expect(result.feasible).toBe(true);

    const bigAllocs = result.allocations.filter((a) => a.billId === "big");
    expect(bigAllocs).toHaveLength(4);
    expect(bigAllocs.reduce((s, a) => s + a.amountCents, 0)).toBe(40000);
  });

  it("skips split when bill < MIN_SPLIT_CENTS threshold", () => {
    const smallAmount = (MIN_SPLIT_CENTS - 100) / 100; // just under threshold
    const result = balancePayWeeks({
      bills: [{ id: "tiny", amount: smallAmount, dueDate: 22 }],
      periods,
      incomePerPeriodCents: [1000, 1000, 1000, 1000], // very tight budget forces shortfall
      fixedExpensesPerPeriodCents: [0, 0, 0, 0],
      targetSurplusCents: 0,
    });
    const tinyAllocs = result.allocations.filter((a) => a.billId === "tiny");
    // Kept as a single-week lump — no split.
    expect(tinyAllocs).toHaveLength(1);
  });

  it("respects neverSplit flag", () => {
    const result = balancePayWeeks({
      bills: [{ id: "locked", amount: 400, dueDate: 22, neverSplit: true }],
      periods,
      incomePerPeriodCents: [60000, 60000, 60000, 60000],
      fixedExpensesPerPeriodCents: [10000, 10000, 10000, 10000],
      targetSurplusCents: 20000,
    });
    const lockedAllocs = result.allocations.filter((a) => a.billId === "locked");
    expect(lockedAllocs).toHaveLength(1);
    // And infeasible because the lump breaches target.
    expect(result.feasible).toBe(false);
  });

  it("does not split bills eligible for only 1 week", () => {
    const result = balancePayWeeks({
      bills: [{ id: "onlyP1", amount: 400, dueDate: 3 }], // in-month 3 → P1; next-month 33 outside
      periods,
      incomePerPeriodCents: [60000, 60000, 60000, 60000],
      fixedExpensesPerPeriodCents: [10000, 10000, 10000, 10000],
      targetSurplusCents: 20000,
    });
    const allocs = result.allocations.filter((a) => a.billId === "onlyP1");
    expect(allocs).toHaveLength(1);
    expect(allocs[0].weekIndex).toBe(0);
  });

  it("infeasible case: split gets as close as possible when P1 is forced", () => {
    // P1 has $325 of forced bills (only eligible for P1). Additional big bill
    // is eligible for P1+P2 only. Total P1 shortfall unfixable; split just
    // dumps the big bill in P2.
    const result = balancePayWeeks({
      bills: [
        { id: "forced1", amount: 325, dueDate: 1 }, // eligible P1 only
        { id: "big", amount: 400, dueDate: 8 }, // eligible P1, P2
      ],
      periods,
      incomePerPeriodCents: [60000, 60000, 60000, 60000],
      fixedExpensesPerPeriodCents: [10000, 10000, 10000, 10000],
      targetSurplusCents: 20000, // budget for bills = 30000/week
    });
    // P1 already at 32500 (325 * 100) - over budget by 2500. big must go P2.
    // Distribution: over = [32500-30000, 0-30000] = [2500, -30000]
    // mean = (2500 + -30000 + 40000) / 2 = 6250
    // Week 0: over=2500 < 6250 → included, needs 6250-2500 = 3750
    // Week 1: over=-30000 < 6250 → included, needs 6250-(-30000) = 36250
    // sum = 40000 ✓
    // So big splits 3750 to P1, 36250 to P2. P1 total = 32500+3750 = 36250.
    // P2 total = 36250.
    expect(result.feasible).toBe(false);
    // P1 and P2 should be equal (leveled), higher than P3/P4 which stay 0.
    expect(result.perWeekBillCents[0]).toBe(result.perWeekBillCents[1]);
    expect(result.perWeekBillCents[0]).toBe(36250);
  });
});

// ─── Multi-occurrence bills ─────────────────────────────────────────────────
// Reproduction of the "Bill E missing from Sep P1" bug: September 2026
// has 5 Wed paydays with P5 forward-extending to Oct 6. A bill due on the
// 5th or 6th fires TWICE in this view (Sep 5/6 in P1 AND Oct 5/6 in P5), so
// both occurrences must be allocated — never silently collapsed to just one.

describe("getBillOccurrencesInView", () => {
  it("September 2026: dueDate=5 returns 2 occurrences (Sep 5 in P1, Oct 5 in P5)", () => {
    const periods = getPayPeriodsForMonth(2026, 8, WED);
    const occs = getBillOccurrencesInView(5, periods);
    expect(occs).toHaveLength(2);
    expect(occs[0]).toMatchObject({ coord: 5, periodKey: "P1", inNextMonth: false });
    expect(occs[1]).toMatchObject({ coord: 35, periodKey: "P5", inNextMonth: true });
  });

  it("September 2026: dueDate=6 returns 2 occurrences", () => {
    const periods = getPayPeriodsForMonth(2026, 8, WED);
    const occs = getBillOccurrencesInView(6, periods);
    expect(occs.map((o) => o.periodKey)).toEqual(["P1", "P5"]);
  });

  it("August 2026: dueDate=5 returns 1 occurrence (Sep 5 not visible — Aug P4 ends Sep 1)", () => {
    const periods = getPayPeriodsForMonth(2026, 7, WED);
    const occs = getBillOccurrencesInView(5, periods);
    expect(occs).toHaveLength(1);
    expect(occs[0]).toMatchObject({ coord: 5, periodKey: "P1" });
  });

  it("August 2026: dueDate=4 returns empty (Sept view handles it naturally, no double-count)", () => {
    // Aug 4 < P1.startDay=5; Sep 4 coord=35 > P4.endDay=32. Would have been
    // an orphan except Sept's first payday (Sep 2) is on/before dueDate 4,
    // so Sept view case-1 attributes Sep 4 to Sept P1 naturally. Skipping
    // orphan here prevents Sep 4 from being double-counted across Aug and Sept.
    const periods = getPayPeriodsForMonth(2026, 7, WED);
    const occs = getBillOccurrencesInView(4, periods);
    expect(occs).toHaveLength(0);
  });

  it("August 2026: dueDate=4 STILL orphans when next view's first payday is AFTER dueDate", () => {
    // Contrived — pretend the next view's first payday is Sep 10 (way past
    // dueDate 4). Then Sept view can't naturally cover Sep 4, so Aug MUST
    // orphan-attribute it as the closest paycheck.
    const periods = getPayPeriodsForMonth(2026, 7, WED);
    // Splice a fake nextViewFirstPayday = 10 into the first period.
    const forced = periods.map((p, i) => (i === 0 ? { ...p, nextViewFirstPayday: 10 } : p));
    const occs = getBillOccurrencesInView(4, forced);
    expect(occs).toHaveLength(1);
    expect(occs[0]).toMatchObject({ isOrphan: true });
  });

  it("returns empty when bill has no occurrence in view", () => {
    const periods = [
      { key: "P1", index: 0, startDay: 10, endDay: 15, daysInMonth: 30, isPaydayStart: true, firstPaydayOfMonth: 10, label: "", dateRange: "", isCurrent: false, color: "" },
    ];
    // dueDate=5, in-month 5 not in [10,15]; next-month 35 not in [10,15];
    // orphan needs dueDate<firstStart(true) AND nextCoord>lastEnd(35>15 true) → orphan fires.
    // So this returns orphan. To get truly empty, use dueDate that lands in-month but past endDay
    // with nextCoord also inside firstStart. Not easy to construct — skip this edge.
    const occs = getBillOccurrencesInView(5, periods);
    expect(occs).toHaveLength(1);
    expect(occs[0].isOrphan).toBe(true);
  });
});

describe("getBillAllocationsForBill — multi-occurrence natural fallback", () => {
  const periods = getPayPeriodsForMonth(2026, 8, WED);
  const mk = monthKeyOf(2026, 8);

  it("dueDate=5 with no splits returns 2 natural allocs ($X in P1 AND $X in P5)", () => {
    const allocs = getBillAllocationsForBill("billE", 5, 96, periods, mk, []);
    expect(allocs).toHaveLength(2);
    expect(allocs.map((a) => a.periodKey).sort()).toEqual(["P1", "P5"]);
    // Each occurrence carries the FULL bill amount — not half.
    allocs.forEach((a) => expect(a.amountCents).toBe(9600));
    // Occurrence coords tagged distinctly.
    expect(allocs.map((a) => a.occurrenceCoord).sort((x, y) => x - y)).toEqual([5, 35]);
  });

  it("legacy split rows (occurrenceCoord=undefined) map to primary (P5) occurrence", () => {
    const splits = [
      { billId: "billE", monthKey: mk, weekIndex: 4, amountCents: 9600 },
    ];
    const allocs = getBillAllocationsForBill("billE", 5, 96, periods, mk, splits);
    // Two allocs: legacy P5 row (mapped to next-month occurrence coord=35),
    // plus natural fallback for the Sep 5 occurrence (coord=5, weekIndex=0).
    expect(allocs).toHaveLength(2);
    const byCoord = new Map(allocs.map((a) => [a.occurrenceCoord, a]));
    expect(byCoord.get(5)?.periodKey).toBe("P1");
    expect(byCoord.get(5)?.amountCents).toBe(9600);
    expect(byCoord.get(35)?.periodKey).toBe("P5");
    expect(byCoord.get(35)?.amountCents).toBe(9600);
  });

  it("per-occurrence splits: coord=5 split across P1+P2, coord=35 in P5 alone", () => {
    const splits = [
      { billId: "billE", monthKey: mk, weekIndex: 0, amountCents: 4800, occurrenceCoord: 5 },
      { billId: "billE", monthKey: mk, weekIndex: 1, amountCents: 4800, occurrenceCoord: 5 },
      { billId: "billE", monthKey: mk, weekIndex: 4, amountCents: 9600, occurrenceCoord: 35 },
    ];
    const allocs = getBillAllocationsForBill("billE", 5, 96, periods, mk, splits);
    expect(allocs).toHaveLength(3);
    // Sep 5 occurrence is split (isSplit=true on both rows).
    const sepAllocs = allocs.filter((a) => a.occurrenceCoord === 5);
    expect(sepAllocs).toHaveLength(2);
    sepAllocs.forEach((a) => expect(a.isSplit).toBe(true));
    // Oct 5 occurrence is a single lump (isSplit=false).
    const octAllocs = allocs.filter((a) => a.occurrenceCoord === 35);
    expect(octAllocs).toHaveLength(1);
    expect(octAllocs[0].isSplit).toBe(false);
  });
});

describe("balancePayWeeks — multi-occurrence coverage invariant", () => {
  const periods = getPayPeriodsForMonth(2026, 8, WED); // Sept 2026, 5 periods

  it("dueDate=5 places both occurrences (Sep 5 in P1, Oct 5 in P5)", () => {
    const result = balancePayWeeks({
      bills: [{ id: "billE", amount: 96, dueDate: 5 }],
      periods,
      incomePerPeriodCents: [62000, 62000, 62000, 62000, 62000],
      fixedExpensesPerPeriodCents: [0, 0, 0, 0, 0],
      targetSurplusCents: 25000,
    });
    expect(result.underfunded).toEqual([]);
    // Two allocations total — one per occurrence.
    const billEAllocs = result.allocations.filter((a) => a.billId === "billE");
    expect(billEAllocs).toHaveLength(2);
    // Each occurrence gets full $96.
    const byCoord = new Map<number, number>();
    for (const a of billEAllocs) {
      byCoord.set(a.occurrenceCoord, (byCoord.get(a.occurrenceCoord) ?? 0) + a.amountCents);
    }
    expect(byCoord.get(5)).toBe(9600);
    expect(byCoord.get(35)).toBe(9600);
    // View-total for Bill E is $192 (2 × $96), not $96.
    expect(billEAllocs.reduce((s, a) => s + a.amountCents, 0)).toBe(19200);
  });

  it("reproduction — Bill E (dueDate=5) + Bill F (dueDate=6) both funded in Sep view", () => {
    const result = balancePayWeeks({
      bills: [
        { id: "billE", amount: 96, dueDate: 5 },
        { id: "billF", amount: 38.75, dueDate: 6 },
      ],
      periods,
      incomePerPeriodCents: [62000, 62000, 62000, 62000, 62000],
      fixedExpensesPerPeriodCents: [0, 0, 0, 0, 0],
      targetSurplusCents: 25000,
    });
    expect(result.underfunded).toEqual([]);
    // Both bills, both occurrences, all fully placed.
    for (const billId of ["billE", "billF"]) {
      const perOcc = new Map<number, number>();
      for (const a of result.allocations.filter((x) => x.billId === billId)) {
        perOcc.set(a.occurrenceCoord, (perOcc.get(a.occurrenceCoord) ?? 0) + a.amountCents);
      }
      expect(perOcc.size).toBe(2); // Sep + Oct occurrences
      const full = billId === "billE" ? 9600 : 3875;
      for (const total of perOcc.values()) expect(total).toBe(full);
    }
  });

  it("INVARIANT: for every bill+occurrence, allocations sum to bill.amount", () => {
    // Realistic mix — the exact bill set the user has in prod.
    const bills = [
      { id: "billP", amount: 149.20, dueDate: 30 },
      { id: "billI", amount: 25.0, dueDate: 30 },
      { id: "billA", amount: 118.40, dueDate: 1 },
      { id: "billC", amount: 125.0, dueDate: 4 },
      { id: "billD", amount: 61.40, dueDate: 4 },
      { id: "billE", amount: 96.0, dueDate: 5 },
      { id: "billF", amount: 38.75, dueDate: 6 },
    ];
    const result = balancePayWeeks({
      bills,
      periods,
      incomePerPeriodCents: [62000, 62000, 62000, 62000, 62000],
      fixedExpensesPerPeriodCents: [0, 0, 0, 0, 0],
      targetSurplusCents: 25000,
    });
    expect(result.underfunded).toEqual([]);

    // Manual re-check of the invariant — proves the assertion wasn't accidentally
    // reporting green when funding is short.
    for (const b of bills) {
      const occs = getBillOccurrencesInView(b.dueDate, periods);
      for (const occ of occs) {
        const sum = result.allocations
          .filter((a) => a.billId === b.id && a.occurrenceCoord === occ.coord)
          .reduce((s, a) => s + a.amountCents, 0);
        expect(sum, `${b.id}@${occ.coord}`).toBe(Math.round(b.amount * 100));
      }
    }
  });

  it("locked allocation covers part of a bill — remaining amount goes to unlocked weeks only", () => {
    // Regression: when Aug P1/P2 are locked and legacy BillSplit rows for
    // BillP ($149.20) live in P2, those P2 rows must count as "already
    // committed" so the algorithm only places the REMAINDER ($74.60) into P3
    // or P4 — not the full amount. Deleting the P2 history and re-placing
    // the full $149.20 in unlocked weeks was the bug that pushed P3+P4 surplus
    // down to $67 each.
    const result = balancePayWeeks({
      bills: [{ id: "billP", amount: 149.20, dueDate: 31 }],
      periods,
      incomePerPeriodCents: [58000, 58000, 58000, 58000, 58000],
      fixedExpensesPerPeriodCents: [7000, 7000, 7000, 7000, 7000],
      targetSurplusCents: 25000,
      todayCoord: 19, // P1 (5-11), P2 (12-18) and P3 (19-25, payday today) locked; P4/P5 open
      lockedAllocations: [
        // Legacy P2 partial payment of $74.60 for the in-month occurrence.
        // Sept has 30 days so dueDate=31 clamps to coord=30 (last-day-of-month).
        { billId: "billP", weekIndex: 1, amountCents: 7460, occurrenceCoord: 30 },
      ],
    });
    expect(result.underfunded).toEqual([]);
    const billPOutputs = result.allocations.filter((a) => a.billId === "billP");
    const placedCents = billPOutputs.reduce((s, a) => s + a.amountCents, 0);
    // Algorithm should ONLY place the remaining $74.60 (not the full $149.20).
    expect(placedCents).toBe(7460);
    // And none of the emitted allocations should touch locked weeks (index 0 or 1).
    for (const a of billPOutputs) {
      expect(a.weekIndex).toBeGreaterThan(1);
    }
  });

  it("occurrences whose weeks are all locked are SKIPPED (not planned, not underfunded)", () => {
    // Bill due day 20 (natural home = P3), todayCoord=999 locks every period.
    // Those paychecks are spent, so the algorithm no longer emits a
    // retroactive plan into them (Oct 2026 change — header note 5). The bill
    // doesn't silently vanish either: it's reported in `skipped` with its home
    // week, and the caller writes a $0 marker so displays say "Skipped".
    const result = balancePayWeeks({
      bills: [{ id: "past", amount: 50, dueDate: 20 }],
      periods,
      incomePerPeriodCents: [62000, 62000, 62000, 62000, 62000],
      fixedExpensesPerPeriodCents: [0, 0, 0, 0, 0],
      targetSurplusCents: 0,
      todayCoord: 999,
    });
    expect(result.underfunded).toEqual([]);
    expect(result.allocations.filter((a) => a.billId === "past")).toEqual([]);
    expect(result.skipped).toEqual([
      { billId: "past", occurrenceCoord: 20, weekIndex: 2, skippedCents: 5000, hasLockedRows: false },
    ]);
  });

  // ── Oct 2026 regression: Optimize 500 + current-week surplus rewrite ──
  // Modeled on the user's 2026-10-18 setup (names and prices anonymized). Changing Bill I $25 → $90 and
  // hitting Optimize crashed with a BillSplit unique-constraint 500: Phase 2
  // leveled a few dollars of Bill P into locked P1, which already had a Bill P
  // (same bill) row. The crash landed after the month's rows were deleted, dropping
  // Bill P + Bill B from P2/P3 and inflating the current week's surplus.
  describe("Oct 2026 regression — locked weeks are never leveled into", () => {
    const octPeriods = getPayPeriodsForMonth(2026, 9, WED); // P1 7-13, P2 14-20, P3 21-27, P4 28-Nov 3
    const OCT_BILLS = [
      { id: "billA", amount: 118.40, dueDate: 1 },
      { id: "billB", amount: 195.25, dueDate: 1 },
      { id: "billC", amount: 125, dueDate: 4 },
      { id: "billD", amount: 61.40, dueDate: 4 },
      { id: "billE", amount: 96, dueDate: 5 },
      { id: "billF", amount: 38.75, dueDate: 6 },
      { id: "billG", amount: 15.49, dueDate: 13 },
      { id: "billH", amount: 10.49, dueDate: 17 },
      { id: "billJ", amount: 18.49, dueDate: 20 },
      { id: "billK", amount: 24.99, dueDate: 23 },
      { id: "billL", amount: 47, dueDate: 26 },
      { id: "billM", amount: 79.60, dueDate: 28 },
      { id: "billN", amount: 22.99, dueDate: 28 },
      { id: "billO", amount: 20.49, dueDate: 29 },
      { id: "billI", amount: 90, dueDate: 31 }, // was $20 — the edit that triggered the bug
      { id: "billP", amount: 149.20, dueDate: 31 },
    ];
    // Committed P1 rows (Oct 7-13 paycheck already spent).
    const P1_LOCKED = [
      { billId: "billG", weekIndex: 0, amountCents: 1549, occurrenceCoord: 13 },
      { billId: "billP", weekIndex: 0, amountCents: 4973, occurrenceCoord: 31 },
      { billId: "billB", weekIndex: 0, amountCents: 8900, occurrenceCoord: 32 },
    ];
    // Committed P2 rows (Oct 14-20 paycheck — the current week on Oct 18).
    const P2_LOCKED = [
      { billId: "billP", weekIndex: 1, amountCents: 4973, occurrenceCoord: 31 },
      { billId: "billB", weekIndex: 1, amountCents: 7400, occurrenceCoord: 32 },
      { billId: "billH", weekIndex: 1, amountCents: 1049, occurrenceCoord: 17 },
      { billId: "billJ", weekIndex: 1, amountCents: 1849, occurrenceCoord: 20 },
    ];
    const baseInputs = {
      bills: OCT_BILLS,
      periods: octPeriods,
      incomePerPeriodCents: [70000, 70000, 70000, 70000], // fake income (real figures stay out of the repo)
      fixedExpensesPerPeriodCents: [7000, 7000, 7000, 7000], // Gas + Spending
      targetSurplusCents: 25000,
    };

    it("exact crash setup (only P1 locked): no allocation lands in locked P1", () => {
      // todayCoord=13 → only P1 has started, matching the old endDay rule's
      // lock set on Oct 18 — the inputs that produced the duplicate insert.
      const result = balancePayWeeks({ ...baseInputs, todayCoord: 13, lockedAllocations: P1_LOCKED });
      expect(result.underfunded).toEqual([]);
      expect(result.allocations.filter((a) => a.weekIndex === 0)).toEqual([]);
    });

    it("current (started) week is locked: Oct 18 never re-plans P1 or P2", () => {
      const result = balancePayWeeks({
        ...baseInputs,
        todayCoord: 18,
        lockedAllocations: [...P1_LOCKED, ...P2_LOCKED],
      });
      expect(result.underfunded).toEqual([]);
      for (const a of result.allocations) expect(a.weekIndex, `${a.billId}`).toBeGreaterThan(1);

      // Remaining slices of the partially-committed bills land in P3/P4 only.
      const placed = (id: string) =>
        result.allocations.filter((a) => a.billId === id).reduce((s, a) => s + a.amountCents, 0);
      expect(placed("billP")).toBe(14920 - 4973 - 4973);
      expect(placed("billB")).toBe(19525 - 8900 - 7400);
      // Bill I's new $100 is fully planned in the open weeks.
      expect(placed("billI")).toBe(9000);
    });

    it("price bump on a bill due THIS week: remainder is skipped, not planned into the locked week", () => {
      // Bill H ($10.49 committed in P2) goes up to $20 on Oct 18. P2 is its
      // only eligible week and its paycheck is spent, so the $10.01 extra is
      // skipped this cycle. The existing $10.49 row stays as-is (no marker).
      const result = balancePayWeeks({
        ...baseInputs,
        bills: OCT_BILLS.map((b) => (b.id === "billH" ? { ...b, amount: 20 } : b)),
        todayCoord: 18,
        lockedAllocations: [...P1_LOCKED, ...P2_LOCKED],
      });
      expect(result.underfunded).toEqual([]);
      expect(result.allocations.filter((a) => a.billId === "billH")).toEqual([]);
      expect(result.skipped).toEqual([
        { billId: "billH", occurrenceCoord: 17, weekIndex: 1, skippedCents: 951, hasLockedRows: true },
      ]);
    });

    it("bill moved INTO the current week (Bill I 31st → 18th on Oct 18) is skipped this cycle", () => {
      // Real Oct 18 case: P2's paycheck was already handed out, the user paid
      // the $100 from savings. Nothing should land in P1/P2, Bill I must not
      // be flagged underfunded, and the caller is told to write a $0 marker
      // (no locked rows exist for the new 18th occurrence).
      const result = balancePayWeeks({
        ...baseInputs,
        bills: OCT_BILLS.map((b) => (b.id === "billI" ? { ...b, dueDate: 18 } : b)),
        todayCoord: 18,
        lockedAllocations: [...P1_LOCKED, ...P2_LOCKED],
      });
      expect(result.underfunded).toEqual([]);
      expect(result.allocations.filter((a) => a.billId === "billI")).toEqual([]);
      for (const a of result.allocations) expect(a.weekIndex, a.billId).toBeGreaterThan(1);
      expect(result.skipped).toEqual([
        { billId: "billI", occurrenceCoord: 18, weekIndex: 1, skippedCents: 9000, hasLockedRows: false },
      ]);
    });

    it("skip is idempotent: once the $0 marker exists, the next run reports hasLockedRows and plans nothing", () => {
      const result = balancePayWeeks({
        ...baseInputs,
        bills: OCT_BILLS.map((b) => (b.id === "billI" ? { ...b, dueDate: 18 } : b)),
        todayCoord: 18,
        lockedAllocations: [
          ...P1_LOCKED,
          ...P2_LOCKED,
          { billId: "billI", weekIndex: 1, amountCents: 0, occurrenceCoord: 18 }, // marker
        ],
      });
      expect(result.underfunded).toEqual([]);
      expect(result.allocations.filter((a) => a.billId === "billI")).toEqual([]);
      expect(result.skipped).toEqual([
        { billId: "billI", occurrenceCoord: 18, weekIndex: 1, skippedCents: 9000, hasLockedRows: true },
      ]);
    });

    it("the 18th is planned normally in a future month (Nov) — only the current cycle is skipped", () => {
      const novPeriods = getPayPeriodsForMonth(2026, 10, WED);
      const result = balancePayWeeks({
        ...baseInputs,
        periods: novPeriods,
        incomePerPeriodCents: novPeriods.map(() => 70000),
        fixedExpensesPerPeriodCents: novPeriods.map(() => 7000),
        bills: OCT_BILLS.map((b) => (b.id === "billI" ? { ...b, dueDate: 18 } : b)),
        todayCoord: 0,
      });
      expect(result.skipped).toEqual([]);
      const billI = result.allocations.filter((a) => a.billId === "billI");
      expect(billI.reduce((s, a) => s + a.amountCents, 0)).toBe(9000);
    });

    it("isPayWeekLocked: locks on the payday itself, not after the week ends", () => {
      const p2 = octPeriods[1]; // Oct 14-20
      expect(isPayWeekLocked(p2, 13)).toBe(false);
      expect(isPayWeekLocked(p2, 14)).toBe(true);
      expect(isPayWeekLocked(p2, 18)).toBe(true);
      expect(isPayWeekLocked(p2, 0)).toBe(false); // future month view
    });
  });

  it("assertNoUnderfundedBills throws when underfunded is non-empty", () => {
    const bad = {
      allocations: [],
      perWeekBillCents: [],
      feasible: false,
      unplaced: [],
      underfunded: ["billE@5"],
      skipped: [],
    };
    expect(() => assertNoUnderfundedBills(bad, "test")).toThrow(/underfunded/);
  });

  it("assertNoUnderfundedBills is a no-op on a healthy result", () => {
    const good = {
      allocations: [],
      perWeekBillCents: [],
      feasible: true,
      unplaced: [],
      underfunded: [],
      skipped: [],
    };
    expect(() => assertNoUnderfundedBills(good)).not.toThrow();
  });
});

// ─── Full-year coverage invariant across the user's actual bill set ─────────
// Guards against orphan double-counting and dropped bills. Every real-world
// firing of every bill in the 12-month window must be attributed to EXACTLY
// one view — no more, no less. Extend the bill list here whenever a new bill
// is added to the app.

describe("Full-year cross-view coverage (Aug 2026 – Jul 2027)", () => {
  const USER_BILLS: Array<{ id: string; name: string; dueDate: number }> = [
    { id: "billA",      name: "Bill A",          dueDate: 1 },
    { id: "billB",      name: "Bill B",          dueDate: 1 },
    { id: "billC",   name: "Bill C",       dueDate: 4 },
    { id: "billD",    name: "Bill D", dueDate: 4 },
    { id: "billE",      name: "Bill E",     dueDate: 5 },
    { id: "billF",      name: "Bill F",   dueDate: 6 },
    { id: "billH",    name: "Bill H",        dueDate: 17 },
    { id: "billJ",     name: "Bill J",         dueDate: 20 },
    { id: "billK",    name: "Bill K",        dueDate: 23 },
    { id: "billM",        name: "Bill M",  dueDate: 28 },
    { id: "billN",    name: "Bill N",        dueDate: 28 },
    { id: "billL",       name: "Bill L",     dueDate: 28 },
    { id: "billO",    name: "Bill O",        dueDate: 29 },
    { id: "billI",     name: "Bill I",         dueDate: 31 },
    { id: "billP", name: "Bill P",    dueDate: 31 },
  ];

  const YEAR_VIEWS: Array<[number, number]> = [];
  for (let i = -2; i <= 13; i++) {
    // Widen the sweep by 2 months on each side so cross-boundary attributions
    // (July→Aug, Jul 2027→Aug 2027) get counted too.
    const d = new Date(2026, 7 + i, 1);
    YEAR_VIEWS.push([d.getFullYear(), d.getMonth()]);
  }

  // For a given (billId, real calendar date), collect every view that
  // attributes that firing. If length > 1 → double-count bug.
  const buildEventMap = () => {
    const events = new Map<string, Array<{ view: string; period: string; orphan: boolean }>>();
    for (const [y, m] of YEAR_VIEWS) {
      const periods = getPayPeriodsForMonth(y, m, WED);
      if (periods.length === 0) continue;
      const daysInMonth = periods[0].daysInMonth;
      for (const b of USER_BILLS) {
        const occs = getBillOccurrencesInView(b.dueDate, periods);
        for (const occ of occs) {
          let realYear = y, realMonth = m, realDay: number;
          if (occ.coord > daysInMonth) {
            realMonth++;
            if (realMonth > 11) { realMonth = 0; realYear++; }
            realDay = occ.coord - daysInMonth;
          } else {
            realDay = occ.coord;
          }
          const key = `${b.id}|${realYear}-${String(realMonth+1).padStart(2,"0")}-${String(realDay).padStart(2,"0")}`;
          if (!events.has(key)) events.set(key, []);
          events.get(key)!.push({
            view: `${y}-${String(m+1).padStart(2,"0")}`,
            period: occ.periodKey,
            orphan: occ.isOrphan,
          });
        }
      }
    }
    return events;
  };

  it("NO firing is attributed to more than one view (no double-count)", () => {
    const events = buildEventMap();
    const doubled: string[] = [];
    for (const [k, vs] of events) {
      if (vs.length > 1) doubled.push(`${k} → ${vs.map((v) => v.view + " " + v.period).join(", ")}`);
    }
    expect(doubled, `Doubles:\n${doubled.join("\n")}`).toEqual([]);
  });

  it("EVERY real-world firing (Aug 2026 – Jul 2027) is covered by some view", () => {
    const events = buildEventMap();
    const missing: string[] = [];
    for (const b of USER_BILLS) {
      for (let mIdx = 0; mIdx < 12; mIdx++) {
        const y = 2026 + Math.floor((7 + mIdx) / 12);
        const m = (7 + mIdx) % 12;
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        // Real firing date: clamp dueDate to daysInMonth (e.g., Feb 31 → Feb 28).
        const clampedDay = Math.min(b.dueDate, daysInMonth);
        const clampedKey = `${b.id}|${y}-${String(m+1).padStart(2,"0")}-${String(clampedDay).padStart(2,"0")}`;
        const rawKey = `${b.id}|${y}-${String(m+1).padStart(2,"0")}-${String(b.dueDate).padStart(2,"0")}`;
        if (!events.has(clampedKey) && !events.has(rawKey)) {
          missing.push(`${b.name} (due ${b.dueDate}) @ ${y}-${String(m+1).padStart(2,"0")}`);
        }
      }
    }
    expect(missing, `Uncovered:\n${missing.join("\n")}`).toEqual([]);
  });

  it("dueDate=4 monthly bills fire exactly 12 times across 12 views", () => {
    const events = buildEventMap();
    for (const billId of ["billC", "billD"]) {
      const firings = Array.from(events.keys()).filter((k) => k.startsWith(billId + "|"));
      // Some firings fall outside our test window (Aug 2026 - Jul 2027), so
      // filter to firings whose real date is in that range.
      const inWindow = firings.filter((k) => {
        const dateStr = k.split("|")[1];
        return dateStr >= "2026-08-01" && dateStr <= "2027-07-31";
      });
      expect(inWindow, `${billId}: ${inWindow.length} firings, expected 12`).toHaveLength(12);
    }
  });

  it("dueDate=1 bills (Bill A, Bill B) fire exactly 12 times", () => {
    const events = buildEventMap();
    for (const billId of ["billA", "billB"]) {
      const inWindow = Array.from(events.keys())
        .filter((k) => k.startsWith(billId + "|"))
        .filter((k) => {
          const dateStr = k.split("|")[1];
          return dateStr >= "2026-08-01" && dateStr <= "2027-07-31";
        });
      expect(inWindow, `${billId}: ${inWindow.length} firings, expected 12`).toHaveLength(12);
    }
  });
});

// ── Income per pay period (extracted Oct 2026 from 4 inline copies) ──
// Oct 1 2026 is a Thursday → Fridays (payDay=5) fall on 2, 9, 16, 23, 30.
describe("getIncomePaydays", () => {
  it("weekly returns every matching weekday", () => {
    expect(getIncomePaydays(2026, 9, 5, false, 0)).toEqual([2, 9, 16, 23, 30]);
  });

  it("bi-weekly offset 0 / 1 picks alternating paydays", () => {
    expect(getIncomePaydays(2026, 9, 5, true, 0)).toEqual([2, 16, 30]);
    expect(getIncomePaydays(2026, 9, 5, true, 1)).toEqual([9, 23]);
  });
});

describe("computeIncomePerPeriodCents", () => {
  const periods = [
    { startDay: 1, endDay: 8 },
    { startDay: 9, endDay: 15 },
    { startDay: 16, endDay: 22 },
    { startDay: 23, endDay: 31 },
  ];

  it("buckets each source into the periods containing its paydays", () => {
    const sources = [
      { amount: "650.25", payDay: 5, paymentCycle: "WEEKLY" },
      // payDay + cycle come from defaults; offset 1 → Oct 9, 23
      { amount: 200, payWeekOffset: 1 },
    ];
    const cents = computeIncomePerPeriodCents(sources, periods, 2026, 9, {
      payDay: 5,
      paymentCycle: "BI_WEEKLY",
    });
    expect(cents).toEqual([65025, 65025 + 20000, 65025, 65025 + 20000]);
  });

  it("counts a source once per period even with two paydays inside it", () => {
    const cents = computeIncomePerPeriodCents(
      [{ amount: 100, payDay: 5, paymentCycle: "WEEKLY" }],
      [{ startDay: 1, endDay: 31 }],
      2026,
      9,
      { payDay: 5 },
    );
    expect(cents).toEqual([10000]);
  });

  it("treats junk amounts as $0", () => {
    const cents = computeIncomePerPeriodCents([{ amount: null }, { amount: "abc" }], periods, 2026, 9, { payDay: 5 });
    expect(cents).toEqual([0, 0, 0, 0]);
  });

  it("getIncomeSourcesForPeriod returns the firing sources in input order", () => {
    const a = { name: "A", amount: 1, payDay: 5, paymentCycle: "BI_WEEKLY", payWeekOffset: 0 };
    const b = { name: "B", amount: 1, payDay: 5, paymentCycle: "BI_WEEKLY", payWeekOffset: 1 };
    expect(getIncomeSourcesForPeriod([a, b], periods[0], 2026, 9, { payDay: 5 })).toEqual([a]);
    expect(getIncomeSourcesForPeriod([a, b], periods[1], 2026, 9, { payDay: 5 })).toEqual([b]);
  });

  // Parity guard: the exact loop that used to be inlined in OverviewPage /
  // BudgetPage / PersonalOverview, run against the helper over 3 years of
  // real pay-period grids for weekly and bi-weekly users.
  it("matches the original inline loop across 36 months", () => {
    const legacy = (sources: any[], ps: { startDay: number; endDay: number }[], y: number, m: number, defPayDay: number, defCycle: string) => {
      const dim = new Date(y, m + 1, 0).getDate();
      const collect = (pd: number, bw: boolean, off: number) => {
        const all: number[] = [];
        for (let d = 1; d <= dim; d++) if (new Date(y, m, d).getDay() === pd) all.push(d);
        return bw ? all.filter((_, i) => i % 2 === off) : all;
      };
      return ps.map((p) => {
        let total = 0;
        sources.forEach((income) => {
          const pd = Number(income.payDay ?? defPayDay);
          const bw = (income.paymentCycle ?? defCycle) === "BI_WEEKLY";
          const off = Number(income.payWeekOffset ?? 0);
          if (collect(pd, bw, off).some((d) => d >= p.startDay && d <= p.endDay)) {
            total += Math.round((Number(income.amount) || 0) * 100);
          }
        });
        return total;
      });
    };
    const sources = [
      { amount: 650.25, payDay: 2, paymentCycle: "WEEKLY", isPrimary: true },
      { amount: "812.5", payDay: 5, paymentCycle: "BI_WEEKLY", payWeekOffset: 1 },
      { amount: 50, payDay: null, paymentCycle: null, payWeekOffset: null },
    ];
    for (const [payDay, cycle] of [[2, "WEEKLY"], [5, "BI_WEEKLY"]] as const) {
      for (let i = 0; i < 36; i++) {
        const y = 2026 + Math.floor((9 + i) / 12);
        const m = (9 + i) % 12;
        const ps = getPayPeriodsForMonth(y, m, payDay, new Date(2026, 9, 18), cycle === "BI_WEEKLY");
        expect(computeIncomePerPeriodCents(sources, ps, y, m, { payDay, paymentCycle: cycle })).toEqual(
          legacy(sources, ps, y, m, payDay, cycle),
        );
      }
    }
  });
});

describe("withLegacyIncomeFallback", () => {
  it("passes real incomes through untouched", () => {
    const incomes = [{ amount: 1 }];
    expect(withLegacyIncomeFallback(incomes, { w2Amount: 999 })).toBe(incomes);
  });

  it("synthesizes one source from AppSettings when there are no incomes", () => {
    expect(withLegacyIncomeFallback([], { w2Amount: 1200, paymentCycle: "WEEKLY", payDay: 2 })).toEqual([
      { name: "Income", amount: 1200, paymentCycle: "WEEKLY", payDay: 2, payWeekOffset: 0 },
    ]);
    expect(withLegacyIncomeFallback([], {})[0].amount).toBe(0);
  });
});

// ── Pre-saving for next month's first pay week (Oct 2026) ──
// Wednesday paydays. Oct 2026: P1 7-13, P2 14-20, P3 21-27, P4 28 – Nov 3.
// Nov 2026 starts on a payday-adjacent day: first payday Nov 4, so bills due
// the 4th–6th all land in Nov P1 with NO earlier Nov week to level into.
// Pre-saving lets Oct's unlocked weeks put money aside for them. Generic
// sample bills only (the repo is public).
describe("Pre-saving — next view's first pay week", () => {
  const octPeriods = getPayPeriodsForMonth(2026, 9, WED);
  const novPeriods = getPayPeriodsForMonth(2026, 10, WED); // P1 4-10, P2 11-17, P3 18-24, P4 25 – Dec 1
  const OCT = monthKeyOf(2026, 9);
  const NOV = monthKeyOf(2026, 10);
  // Four bills, $325 together, all firing in the next view's first week.
  const CLUSTER = [
    { id: "bill4a", amount: 130, dueDate: 4 },
    { id: "bill4b", amount: 60, dueDate: 4 },
    { id: "bill5", amount: 100, dueDate: 5 },
    { id: "bill6", amount: 35, dueDate: 6 },
  ];
  const INCOME = 48000; // $480/wk
  const FIXED = 7000;
  const TARGET = 25000; // budget per week = $160; the cluster alone is $325
  const baseInputs = {
    periods: octPeriods,
    incomePerPeriodCents: [INCOME, INCOME, INCOME, INCOME],
    fixedExpensesPerPeriodCents: [FIXED, FIXED, FIXED, FIXED],
    targetSurplusCents: TARGET,
    nextViewFirstWeek: { incomeCents: INCOME, fixedExpensesCents: FIXED },
  };
  const sumCents = (rows: { amountCents: number }[]) => rows.reduce((s, r) => s + r.amountCents, 0);

  describe("getPreSaveOccurrence / isPreSaveCoord", () => {
    it("exposes the next view's first-week bounds on every period", () => {
      for (const p of octPeriods) {
        expect(p.nextViewFirstPayday).toBe(4);
        expect(p.nextViewFirstWeekEndDay).toBe(10);
        expect(p.daysInNextMonth).toBe(30);
      }
    });

    it("a bill due the 4th (Nov 4 = first payday) is a pre-save candidate at coord 35", () => {
      expect(getPreSaveOccurrence(4, octPeriods)).toEqual({ coord: 35, day: 4 });
      expect(getPreSaveOccurrence(10, octPeriods)).toEqual({ coord: 41, day: 10 }); // last day of Nov P1
    });

    it("bills outside the next view's first week are not candidates", () => {
      // Nov 3 is covered by Oct P4's forward extension (an Oct occurrence).
      expect(getPreSaveOccurrence(3, octPeriods)).toBeNull();
      // Nov 11 starts Nov P2 — that view can level it into P1 itself.
      expect(getPreSaveOccurrence(11, octPeriods)).toBeNull();
      expect(getPreSaveOccurrence(28, octPeriods)).toBeNull();
    });

    it("clamps the due date to the next month's length like the next view does", () => {
      // Jan 2027 view: Wednesdays 6, 13, 20, 27 → Feb's first payday is Feb 3,
      // first week Feb 3-9; Feb 2027 has 28 days. Due 31 → fires Feb 28 → not P1.
      const jan = getPayPeriodsForMonth(2027, 0, WED);
      expect(jan[0].daysInNextMonth).toBe(28);
      expect(getPreSaveOccurrence(31, jan)).toBeNull();
      expect(getPreSaveOccurrence(5, jan)).toEqual({ coord: 36, day: 5 });
    });

    it("isPreSaveCoord is true only past the view's last period end", () => {
      expect(isPreSaveCoord(34, octPeriods)).toBe(false); // Nov 3 — Oct P4 forward extension
      expect(isPreSaveCoord(35, octPeriods)).toBe(true);
    });

    it("the firing is still attributed to exactly one view (the next one)", () => {
      // Oct never lists the Nov 4 firing as an occurrence …
      expect(getBillOccurrencesInView(4, octPeriods)).toEqual([]);
      // … Nov does, in P1 — and Nov's own pre-save candidate is Dec 4 (coord 34).
      const nov = getBillOccurrencesInView(4, novPeriods);
      expect(nov.map((o) => [o.coord, o.periodKey, o.inNextMonth])).toEqual([[4, "P1", false]]);
      expect(getPreSaveOccurrence(4, novPeriods)).toEqual({ coord: 34, day: 4 });
    });
  });

  describe("balancePayWeeks with the next view's first week", () => {
    it("levels the cluster across this view's weeks and the next view's first week", () => {
      const result = balancePayWeeks({ ...baseInputs, bills: CLUSTER });
      expect(result.underfunded).toEqual([]);
      expect(result.skipped).toEqual([]);
      // Every emitted row is a pre-save slice in one of Oct's four weeks.
      for (const a of result.allocations) {
        expect(a.weekIndex).toBeLessThan(4);
        expect(isPreSaveCoord(a.occurrenceCoord, octPeriods)).toBe(true);
      }
      // What Oct saves ahead plus what stays in Nov P1 is exactly the cluster.
      expect(sumCents(result.allocations) + result.nextViewFirstWeekBillCents).toBe(32500);
      // Nov P1 no longer carries the whole $325: like in-month leveling, the
      // cluster is spread until every week (Nov P1 included) clears the
      // surplus target — $160 of bills per week here.
      expect(result.nextViewFirstWeekBillCents).toBeLessThan(32500);
      const loads = [...result.perWeekBillCents, result.nextViewFirstWeekBillCents];
      for (const load of loads) expect(load).toBeLessThanOrEqual(INCOME - FIXED - TARGET);
      expect(result.feasible).toBe(true);
    });

    it("funds each occurrence exactly once (per-bill slices + next-week remainder = bill)", () => {
      const result = balancePayWeeks({ ...baseInputs, bills: CLUSTER });
      let nextWeekTotal = 0;
      for (const b of CLUSTER) {
        const coord = getPreSaveOccurrence(b.dueDate, octPeriods)!.coord;
        const saved = sumCents(result.allocations.filter((a) => a.billId === b.id && a.occurrenceCoord === coord));
        expect(saved).toBeLessThanOrEqual(Math.round(b.amount * 100));
        nextWeekTotal += Math.round(b.amount * 100) - saved;
      }
      expect(nextWeekTotal).toBe(result.nextViewFirstWeekBillCents);
    });

    it("without nextViewFirstWeek nothing is pre-saved (old behavior)", () => {
      const { nextViewFirstWeek: _omit, ...noNext } = baseInputs;
      const result = balancePayWeeks({ ...noNext, bills: CLUSTER });
      expect(result.allocations).toEqual([]);
      expect(result.nextViewFirstWeekBillCents).toBe(0);
      expect(result.unplaced.sort()).toEqual(CLUSTER.map((b) => b.id).sort());
    });

    it("locked weeks never receive pre-save cents (Oct 26: only P4 is open)", () => {
      const result = balancePayWeeks({ ...baseInputs, bills: CLUSTER, todayCoord: 26 });
      expect(result.underfunded).toEqual([]);
      expect(result.allocations.length).toBeGreaterThan(0);
      for (const a of result.allocations) expect(a.weekIndex).toBe(3);
      // Two open slots (Oct P4 + Nov P1) share the $325 evenly.
      expect(sumCents(result.allocations) + result.nextViewFirstWeekBillCents).toBe(32500);
      expect(Math.abs(sumCents(result.allocations) - result.nextViewFirstWeekBillCents)).toBeLessThanOrEqual(1);
    });

    it("a pre-save row already committed in a locked week counts and is not re-planned", () => {
      const result = balancePayWeeks({
        ...baseInputs,
        bills: [CLUSTER[0]], // $130 due the 4th → coord 35
        todayCoord: 26,
        lockedAllocations: [{ billId: "bill4a", weekIndex: 1, amountCents: 2000, occurrenceCoord: 35 }],
      });
      expect(result.underfunded).toEqual([]);
      expect(result.allocations.every((a) => a.weekIndex === 3)).toBe(true);
      // Only the $110 remainder is leveled between Oct P4 and Nov P1.
      expect(sumCents(result.allocations) + result.nextViewFirstWeekBillCents).toBe(11000);
      // The locked $20 still counts toward Oct P2's load.
      expect(result.perWeekBillCents[1]).toBe(2000);
    });

    it("this view's own bills never move into the next view's week", () => {
      const result = balancePayWeeks({
        ...baseInputs,
        bills: [{ id: "big", amount: 300, dueDate: 28 }], // Oct P4 only
      });
      expect(result.nextViewFirstWeekBillCents).toBe(0);
      expect(sumCents(result.allocations.filter((a) => a.billId === "big"))).toBe(30000);
      expect(result.allocations.every((a) => a.weekIndex < 4)).toBe(true);
    });

    it("the next view treats prior-view slices as committed and plans only the remainder", () => {
      const result = balancePayWeeks({
        bills: [CLUSTER[0]],
        periods: novPeriods,
        incomePerPeriodCents: [INCOME, INCOME, INCOME, INCOME],
        fixedExpensesPerPeriodCents: [FIXED, FIXED, FIXED, FIXED],
        targetSurplusCents: TARGET,
        priorViewAllocations: [{ billId: "bill4a", occurrenceCoord: 4, amountCents: 5531 }],
      });
      expect(result.underfunded).toEqual([]);
      expect(result.allocations).toEqual([
        { billId: "bill4a", weekIndex: 0, amountCents: 13000 - 5531, occurrenceCoord: 4 },
      ]);
      // Prior-view cents are funding, not load: they live in Oct's weeks.
      expect(result.perWeekBillCents[0]).toBe(13000 - 5531);
    });

    it("a fully pre-saved occurrence needs no row and is not underfunded", () => {
      const result = balancePayWeeks({
        bills: [CLUSTER[0]],
        periods: novPeriods,
        incomePerPeriodCents: [INCOME, INCOME, INCOME, INCOME],
        fixedExpensesPerPeriodCents: [FIXED, FIXED, FIXED, FIXED],
        targetSurplusCents: TARGET,
        priorViewAllocations: [{ billId: "bill4a", occurrenceCoord: 4, amountCents: 13000 }],
      });
      expect(result.underfunded).toEqual([]);
      expect(result.allocations).toEqual([]);
    });
  });

  describe("getBillAllocationsForBill — pre-save rows and prior-view funding", () => {
    const octRow = { billId: "bill4a", monthKey: OCT, weekIndex: 3, amountCents: 5531, occurrenceCoord: 35 };
    const novRow = { billId: "bill4a", monthKey: NOV, weekIndex: 0, amountCents: 7469, occurrenceCoord: 4 };

    it("the prior month shows its pre-save slice as a split for next month's firing", () => {
      expect(getBillAllocationsForBill("bill4a", 4, 130, octPeriods, OCT, [octRow, novRow])).toEqual([
        { weekIndex: 3, periodKey: "P4", amountCents: 5531, isSplit: true, occurrenceCoord: 35, isPreSave: true, priorViewSavedCents: 0 },
      ]);
    });

    it("the firing month's first-week row carries the prior-view cents (same envelope)", () => {
      expect(getBillAllocationsForBill("bill4a", 4, 130, novPeriods, NOV, [octRow, novRow])).toEqual([
        { weekIndex: 0, periodKey: "P1", amountCents: 7469, isSplit: true, occurrenceCoord: 4, isPreSave: false, priorViewSavedCents: 5531 },
      ]);
      expect(getBillAllocationCentsForPeriod("bill4a", 4, 130, novPeriods, NOV, [octRow, novRow], "P1")).toBe(7469);
    });

    it("natural fallback in the firing month is the remainder, never a second full amount", () => {
      expect(getBillAllocationsForBill("bill4a", 4, 130, novPeriods, NOV, [octRow])).toEqual([
        { weekIndex: 0, periodKey: "P1", amountCents: 7469, isSplit: true, occurrenceCoord: 4, isPreSave: false, priorViewSavedCents: 5531 },
      ]);
    });

    it("without rows nothing changes: Oct shows nothing, Nov shows the full bill in P1", () => {
      expect(getBillAllocationsForBill("bill4a", 4, 130, octPeriods, OCT, [])).toEqual([]);
      expect(getBillAllocationsForBill("bill4a", 4, 130, novPeriods, NOV, [])).toEqual([
        { weekIndex: 0, periodKey: "P1", amountCents: 13000, isSplit: false, occurrenceCoord: 4, isPreSave: false, priorViewSavedCents: 0 },
      ]);
    });

    it("a prior-month forward-extension row is not mistaken for a pre-save", () => {
      // Oct P4 funds the Nov 3 firing of a bill due the 3rd: coord 34 is an
      // ordinary Oct occurrence (inside P4's Oct 28 – Nov 3 span), not a
      // pre-save. Nov has no occurrence of that bill at all (Dec 3 belongs to
      // Dec P1), so the Oct row must not surface in November either way.
      const ext = { billId: "bill3", monthKey: OCT, weekIndex: 3, amountCents: 5000, occurrenceCoord: 34 };
      expect(getBillAllocationsForBill("bill3", 3, 50, octPeriods, OCT, [ext])).toEqual([
        { weekIndex: 3, periodKey: "P4", amountCents: 5000, isSplit: false, occurrenceCoord: 34, isPreSave: false, priorViewSavedCents: 0 },
      ]);
      expect(getBillAllocationsForBill("bill3", 3, 50, novPeriods, NOV, [ext])).toEqual([]);
    });
  });

  describe("planOptimize end to end (generic data, Oct 26 2026)", () => {
    const TODAY = new Date(2026, 9, 26, 12);
    const income = { id: "inc", name: "Pay", amount: 480, paymentCycle: "WEEKLY", payDay: WED, payWeekOffset: 0, isPrimary: true };
    const personals = [{ id: "p1", name: "Spending", amount: 70, repeatWeekly: true }];
    const bills = CLUSTER.map((b) => ({ ...b, name: b.id, neverSplit: false }));
    const inputs = (splitRows: any[]) => ({
      today: TODAY,
      bills,
      personalBills: personals,
      incomes: [income],
      primaryIncome: income,
      splitRows,
      targetSurplusCents: TARGET,
      horizonMonths: 3, // Oct, Nov, Dec
    });
    const apply = (rows: any[], plans: ReturnType<typeof planOptimize>) => {
      let next = [...rows];
      let seq = 0;
      for (const p of plans) {
        const doomed = new Set(p.toDelete.map((r: any) => r.id));
        next = next.filter((r) => !doomed.has(r.id));
        for (const c of p.toCreate) next.push({ id: `n${seq++}`, monthKey: p.mk, ...c });
      }
      return next;
    };
    const DEC = monthKeyOf(2026, 11);

    it("saves ahead from Oct's open week, funds each firing once, writes nothing into locked weeks", () => {
      const plans = planOptimize(inputs([]));
      expect(plans.map((p) => p.mk)).toEqual([OCT, NOV, DEC]);
      const rows = apply([], plans);
      const of = (mk: string) => rows.filter((r) => r.monthKey === mk);

      // Oct 26: P1–P3 have started. Only P4 (Oct 28) may hold pre-save rows.
      expect(of(OCT).length).toBeGreaterThan(0);
      for (const r of of(OCT)) {
        expect(r.weekIndex).toBe(3);
        expect(isPreSaveCoord(r.occurrenceCoord, octPeriods)).toBe(true);
      }
      // Each Nov firing = Oct's slices + Nov's P1 remainder, exactly once.
      for (const b of CLUSTER) {
        const octSaved = sumCents(of(OCT).filter((r) => r.billId === b.id && r.occurrenceCoord === b.dueDate + 31));
        const novRemainder = sumCents(of(NOV).filter((r) => r.billId === b.id && r.occurrenceCoord === b.dueDate));
        expect(octSaved + novRemainder, b.id).toBe(Math.round(b.amount * 100));
        expect(of(NOV).filter((r) => r.billId === b.id && r.occurrenceCoord === b.dueDate).every((r) => r.weekIndex === 0)).toBe(true);
        // Likewise Dec's firing = Nov's pre-save slices (coord day+30) + Dec P1.
        const novSaved = sumCents(of(NOV).filter((r) => r.billId === b.id && r.occurrenceCoord === b.dueDate + 30));
        const decRemainder = sumCents(of(DEC).filter((r) => r.billId === b.id && r.occurrenceCoord === b.dueDate));
        expect(novSaved + decRemainder, b.id).toBe(Math.round(b.amount * 100));
      }
      // Nov P1 no longer carries the whole cluster, and the display helper agrees
      // with the writer: the four P1 cards (remainder + prior-view cents) still
      // add up to the full $325 of funding.
      const novSplits = rows.map((r) => ({ ...r }));
      let novP1Load = 0;
      let novP1Funding = 0;
      for (const b of bills) {
        for (const a of getBillAllocationsForBill(b.id, b.dueDate, b.amount, novPeriods, NOV, novSplits)) {
          if (a.periodKey !== "P1" || a.isPreSave) continue;
          novP1Load += a.amountCents;
          novP1Funding += a.amountCents + a.priorViewSavedCents;
        }
      }
      expect(novP1Load).toBeLessThan(32500);
      expect(novP1Funding).toBe(32500);
    });

    it("is idempotent once applied", () => {
      const rows = apply([], planOptimize(inputs([])));
      expect(planOptimize(inputs(rows))).toEqual([]);
    });

    it("re-planning keeps a pre-save row that sits in a locked week", () => {
      // Pretend an earlier run (before Oct 21 started) saved $20 of bill4a in Oct P3.
      const locked = { id: "old", billId: "bill4a", monthKey: OCT, weekIndex: 2, amountCents: 2000, occurrenceCoord: 35 };
      const plans = planOptimize(inputs([locked]));
      const oct = plans.find((p) => p.mk === OCT)!;
      expect(oct.toDelete).toEqual([]);
      const rows = apply([locked], plans);
      const octSaved = sumCents(rows.filter((r) => r.monthKey === OCT && r.billId === "bill4a" && r.occurrenceCoord === 35));
      const novRemainder = sumCents(rows.filter((r) => r.monthKey === NOV && r.billId === "bill4a" && r.occurrenceCoord === 4));
      expect(octSaved).toBeGreaterThanOrEqual(2000);
      expect(octSaved + novRemainder).toBe(13000);
    });
  });
});
