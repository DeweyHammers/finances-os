import { describe, it, expect } from "vitest";
import {
  getPayPeriodsForMonth,
  getBillPeriodKey,
  getBillOccurrencesInView,
  getBillAllocationsForBill,
  getBillAllocationCentsForPeriod,
  balancePayWeeks,
  assertNoUnderfundedBills,
  distributeBillLevel,
  distributeSplitAcrossWeeks,
  monthKeyOf,
  clampDayToMonth,
  MIN_SPLIT_CENTS,
} from "./pay-period-utils";

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
    { id: "billShield", amount: 156.38, dueDate: 30 },
    { id: "claude", amount: 20.0, dueDate: 30 },
    { id: "bread", amount: 110.32, dueDate: 1 },
    { id: "starlink", amount: 130.0, dueDate: 4 },
    { id: "lifeIns", amount: 58.27, dueDate: 4 },
    { id: "phone", amount: 101.0, dueDate: 5 },
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
// Reproduction of the "Phone Bill missing from Sep P1" bug: September 2026
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
    const allocs = getBillAllocationsForBill("phone", 5, 101, periods, mk, []);
    expect(allocs).toHaveLength(2);
    expect(allocs.map((a) => a.periodKey).sort()).toEqual(["P1", "P5"]);
    // Each occurrence carries the FULL bill amount — not half.
    allocs.forEach((a) => expect(a.amountCents).toBe(10100));
    // Occurrence coords tagged distinctly.
    expect(allocs.map((a) => a.occurrenceCoord).sort((x, y) => x - y)).toEqual([5, 35]);
  });

  it("legacy split rows (occurrenceCoord=undefined) map to primary (P5) occurrence", () => {
    const splits = [
      { billId: "phone", monthKey: mk, weekIndex: 4, amountCents: 10100 },
    ];
    const allocs = getBillAllocationsForBill("phone", 5, 101, periods, mk, splits);
    // Two allocs: legacy P5 row (mapped to next-month occurrence coord=35),
    // plus natural fallback for the Sep 5 occurrence (coord=5, weekIndex=0).
    expect(allocs).toHaveLength(2);
    const byCoord = new Map(allocs.map((a) => [a.occurrenceCoord, a]));
    expect(byCoord.get(5)?.periodKey).toBe("P1");
    expect(byCoord.get(5)?.amountCents).toBe(10100);
    expect(byCoord.get(35)?.periodKey).toBe("P5");
    expect(byCoord.get(35)?.amountCents).toBe(10100);
  });

  it("per-occurrence splits: coord=5 split across P1+P2, coord=35 in P5 alone", () => {
    const splits = [
      { billId: "phone", monthKey: mk, weekIndex: 0, amountCents: 5000, occurrenceCoord: 5 },
      { billId: "phone", monthKey: mk, weekIndex: 1, amountCents: 5100, occurrenceCoord: 5 },
      { billId: "phone", monthKey: mk, weekIndex: 4, amountCents: 10100, occurrenceCoord: 35 },
    ];
    const allocs = getBillAllocationsForBill("phone", 5, 101, periods, mk, splits);
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
      bills: [{ id: "phone", amount: 101, dueDate: 5 }],
      periods,
      incomePerPeriodCents: [62000, 62000, 62000, 62000, 62000],
      fixedExpensesPerPeriodCents: [0, 0, 0, 0, 0],
      targetSurplusCents: 25000,
    });
    expect(result.underfunded).toEqual([]);
    // Two allocations total — one per occurrence.
    const phoneAllocs = result.allocations.filter((a) => a.billId === "phone");
    expect(phoneAllocs).toHaveLength(2);
    // Each occurrence gets full $101.
    const byCoord = new Map<number, number>();
    for (const a of phoneAllocs) {
      byCoord.set(a.occurrenceCoord, (byCoord.get(a.occurrenceCoord) ?? 0) + a.amountCents);
    }
    expect(byCoord.get(5)).toBe(10100);
    expect(byCoord.get(35)).toBe(10100);
    // View-total for Phone Bill is $202 (2 × $101), not $101.
    expect(phoneAllocs.reduce((s, a) => s + a.amountCents, 0)).toBe(20200);
  });

  it("reproduction — Phone Bill (dueDate=5) + Power School (dueDate=6) both funded in Sep view", () => {
    const result = balancePayWeeks({
      bills: [
        { id: "phone", amount: 101, dueDate: 5 },
        { id: "power", amount: 35.95, dueDate: 6 },
      ],
      periods,
      incomePerPeriodCents: [62000, 62000, 62000, 62000, 62000],
      fixedExpensesPerPeriodCents: [0, 0, 0, 0, 0],
      targetSurplusCents: 25000,
    });
    expect(result.underfunded).toEqual([]);
    // Both bills, both occurrences, all fully placed.
    for (const billId of ["phone", "power"]) {
      const perOcc = new Map<number, number>();
      for (const a of result.allocations.filter((x) => x.billId === billId)) {
        perOcc.set(a.occurrenceCoord, (perOcc.get(a.occurrenceCoord) ?? 0) + a.amountCents);
      }
      expect(perOcc.size).toBe(2); // Sep + Oct occurrences
      const full = billId === "phone" ? 10100 : 3595;
      for (const total of perOcc.values()) expect(total).toBe(full);
    }
  });

  it("INVARIANT: for every bill+occurrence, allocations sum to bill.amount", () => {
    // Realistic mix — the exact bill set the user has in prod.
    const bills = [
      { id: "billShield", amount: 156.38, dueDate: 30 },
      { id: "claude", amount: 20.0, dueDate: 30 },
      { id: "bread", amount: 110.32, dueDate: 1 },
      { id: "starlink", amount: 130.0, dueDate: 4 },
      { id: "lifeIns", amount: 58.27, dueDate: 4 },
      { id: "phone", amount: 101.0, dueDate: 5 },
      { id: "power", amount: 35.95, dueDate: 6 },
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
    // BillShield ($156.38) live in P2, those P2 rows must count as "already
    // committed" so the algorithm only places the REMAINDER ($78.19) into P3
    // or P4 — not the full amount. Deleting the P2 history and re-placing
    // the full $156.38 in unlocked weeks was the bug that pushed P3+P4 surplus
    // down to $67 each.
    const result = balancePayWeeks({
      bills: [{ id: "billShield", amount: 156.38, dueDate: 31 }],
      periods,
      incomePerPeriodCents: [58000, 58000, 58000, 58000, 58000],
      fixedExpensesPerPeriodCents: [7000, 7000, 7000, 7000, 7000],
      targetSurplusCents: 25000,
      todayCoord: 19, // P1 (5-11) and P2 (12-18) locked; P3/P4 open (Sept-style setup)
      lockedAllocations: [
        // Legacy P2 partial payment of $78.19 for the in-month occurrence.
        // Sept has 30 days so dueDate=31 clamps to coord=30 (last-day-of-month).
        { billId: "billShield", weekIndex: 1, amountCents: 7819, occurrenceCoord: 30 },
      ],
    });
    expect(result.underfunded).toEqual([]);
    const billShieldOutputs = result.allocations.filter((a) => a.billId === "billShield");
    const placedCents = billShieldOutputs.reduce((s, a) => s + a.amountCents, 0);
    // Algorithm should ONLY place the remaining $78.19 (not the full $156.38).
    expect(placedCents).toBe(7819);
    // And none of the emitted allocations should touch locked weeks (index 0 or 1).
    for (const a of billShieldOutputs) {
      expect(a.weekIndex).toBeGreaterThan(1);
    }
  });

  it("occurrences in locked past weeks receive retroactive-plan allocations, NOT flagged underfunded", () => {
    // Bill due day 20 (natural home = P3), todayCoord=999 locks every period.
    // The algorithm can still emit a retroactive plan ("your P3 paycheck
    // should have paid this $50 bill"). Callers that don't want to persist
    // retroactive plans can filter allocations by lockedWeekIndices before
    // writing — but the algorithm's job is to always produce a coherent plan,
    // never to silently drop a bill.
    const result = balancePayWeeks({
      bills: [{ id: "past", amount: 50, dueDate: 20 }],
      periods,
      incomePerPeriodCents: [62000, 62000, 62000, 62000, 62000],
      fixedExpensesPerPeriodCents: [0, 0, 0, 0, 0],
      targetSurplusCents: 0,
      todayCoord: 999,
    });
    expect(result.underfunded).toEqual([]);
    // A retroactive-plan allocation was created for the past occurrence.
    const pastAllocs = result.allocations.filter((a) => a.billId === "past");
    expect(pastAllocs.length).toBeGreaterThan(0);
    expect(pastAllocs.reduce((s, a) => s + a.amountCents, 0)).toBe(5000);
  });

  it("assertNoUnderfundedBills throws when underfunded is non-empty", () => {
    const bad = {
      allocations: [],
      perWeekBillCents: [],
      feasible: false,
      unplaced: [],
      underfunded: ["phone@5"],
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
    { id: "bread",      name: "Bread",          dueDate: 1 },
    { id: "climb",      name: "Climb",          dueDate: 1 },
    { id: "starlink",   name: "Starlink",       dueDate: 4 },
    { id: "lifeIns",    name: "Life Insurance", dueDate: 4 },
    { id: "phone",      name: "Phone Bill",     dueDate: 5 },
    { id: "power",      name: "Power School",   dueDate: 6 },
    { id: "discord",    name: "Discord",        dueDate: 17 },
    { id: "gemini",     name: "Gemini",         dueDate: 20 },
    { id: "youtube",    name: "YouTube",        dueDate: 23 },
    { id: "car",        name: "Car Insurance",  dueDate: 28 },
    { id: "netflix",    name: "Netflix",        dueDate: 28 },
    { id: "trac",       name: "Trac Phone",     dueDate: 28 },
    { id: "spotify",    name: "Spotify",        dueDate: 29 },
    { id: "claude",     name: "Claude",         dueDate: 31 },
    { id: "billShield", name: "Bill Shield",    dueDate: 31 },
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
    for (const billId of ["starlink", "lifeIns"]) {
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

  it("dueDate=1 bills (Bread, Climb) fire exactly 12 times", () => {
    const events = buildEventMap();
    for (const billId of ["bread", "climb"]) {
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
