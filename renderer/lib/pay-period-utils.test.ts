import { describe, it, expect } from "vitest";
import {
  getPayPeriodsForMonth,
  getBillPeriodKey,
  getBillPeriodKeyWithOverride,
  balanceBillsGreedy,
  distributeSplitAcrossWeeks,
  monthKeyOf,
  clampDayToMonth,
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
    // July 2026 first payday = Jul 1, so June's last period ends Jun 30.
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
    expect(periods[1].dateRange).toBe("Aug 12 – Aug 18");
    expect(periods[2].dateRange).toBe("Aug 19 – Aug 25");
    expect(periods[3].dateRange).toBe("Aug 26 – Sep 1");
  });

  it("stores daysInMonth on every period", () => {
    const periods = getPayPeriodsForMonth(2026, 7, WED);
    periods.forEach((p) => expect(p.daysInMonth).toBe(31));
  });

  it("marks the correct period as current", () => {
    const today = new Date(2026, 5, 12); // June 12 → P2 (10-16)
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
  // P1: 1-7, P2: 8-14, P3: 15-21, P4: 22-28, P5: 29-35 (Jul 29 – Aug 4)

  it("bill due 1st routes to P5 for its Aug 1 occurrence (funded by Jul 29 paycheck)", () => {
    expect(getBillPeriodKey(1, periods)).toBe("P5");
  });

  it("bills due 4th routes to P5 for Aug 4 occurrence", () => {
    expect(getBillPeriodKey(4, periods)).toBe("P5");
  });

  it("bill due 5th falls in P1 (Jul 5 in-month occurrence funded by Jul 1 paycheck)", () => {
    expect(getBillPeriodKey(5, periods)).toBe("P1");
  });

  it("bill due 15th falls in P3 (in-month)", () => {
    expect(getBillPeriodKey(15, periods)).toBe("P3");
  });

  it("bill due 29th falls in P5 (in-month Jul 29)", () => {
    expect(getBillPeriodKey(29, periods)).toBe("P5");
  });

  it("bill due 31st falls in P5 (in-month Jul 31)", () => {
    expect(getBillPeriodKey(31, periods)).toBe("P5");
  });
});

describe("getBillPeriodKey — August 2026 attribution", () => {
  const periods = getPayPeriodsForMonth(2026, 7, WED);
  // P1: 5-11, P2: 12-18, P3: 19-25, P4: 26-32 (Aug 26 – Sep 1)

  it("bill due 1st is NOT attributed to Aug (funded by July's Jul 29 paycheck)", () => {
    // Sep 1 occurrence = 1 + 31 = 32, in P4's forward extension.
    expect(getBillPeriodKey(1, periods)).toBe("P4");
  });

  it("bill due 4th orphaned in Aug view (both Aug 4 and Sep 4 fall outside Aug periods)", () => {
    // Aug 4 < first period start (5); Sep 4 (= 35) > P4 end (32).
    expect(getBillPeriodKey(4, periods)).toBeNull();
  });

  it("bill due 5th falls in P1", () => {
    expect(getBillPeriodKey(5, periods)).toBe("P1");
  });

  it("bill due 28th falls in P4", () => {
    expect(getBillPeriodKey(28, periods)).toBe("P4");
  });

  it("bill due 31st falls in P4", () => {
    expect(getBillPeriodKey(31, periods)).toBe("P4");
  });
});

describe("getBillPeriodKey — empty periods", () => {
  it("returns null when no periods exist", () => {
    expect(getBillPeriodKey(15, [])).toBeNull();
  });
});

describe("getPayPeriodsForMonth — isCurrent behavior", () => {
  it("marks August's P1 current when today is Aug 5 (payday)", () => {
    const aug5 = new Date(2026, 7, 5);
    const periods = getPayPeriodsForMonth(2026, 7, WED, aug5);
    expect(periods[0].isCurrent).toBe(true);
  });

  it("marks August's P4 current when today is Sep 1 (in forward extension)", () => {
    const sep1 = new Date(2026, 8, 1);
    const periods = getPayPeriodsForMonth(2026, 7, WED, sep1);
    expect(periods[periods.length - 1].isCurrent).toBe(true);
  });

  it("no August period is current when today is Aug 1 (before first Aug payday)", () => {
    // Aug 1 belongs to July's pay cycle (P5 = Jul 29 – Aug 4).
    const aug1 = new Date(2026, 7, 1);
    const periods = getPayPeriodsForMonth(2026, 7, WED, aug1);
    expect(periods.every((p) => !p.isCurrent)).toBe(true);
  });

  it("marks July's P5 current when today is Aug 1", () => {
    const aug1 = new Date(2026, 7, 1);
    const periods = getPayPeriodsForMonth(2026, 6, WED, aug1);
    expect(periods[periods.length - 1].isCurrent).toBe(true);
  });
});

describe("getPayPeriodsForMonth — December → January rollover", () => {
  // Dec 2026 Wednesdays: 2, 9, 16, 23, 30. Jan 2027 first Wed: Jan 6.
  it("December's last period extends into January", () => {
    const periods = getPayPeriodsForMonth(2026, 11, WED);
    const last = periods[periods.length - 1];
    expect(last.endDay).toBe(36); // 31 + 5 = Jan 5
    expect(last.dateRange).toBe("Dec 30 – Jan 5");
  });

  it("marks Dec's last period current when today is Jan 1", () => {
    const jan1 = new Date(2027, 0, 1);
    const periods = getPayPeriodsForMonth(2026, 11, WED, jan1);
    expect(periods[periods.length - 1].isCurrent).toBe(true);
  });
});

describe("clampDayToMonth", () => {
  it("clamps day 31 to 30 for June (30-day month)", () => {
    expect(clampDayToMonth(31, 2026, 5)).toBe(30);
  });

  it("clamps day 30 to 28 for February 2027 (non-leap)", () => {
    expect(clampDayToMonth(30, 2027, 1)).toBe(28);
  });

  it("clamps day 30 to 29 for February 2028 (leap year)", () => {
    expect(clampDayToMonth(30, 2028, 1)).toBe(29);
  });

  it("does not clamp day 31 for a 31-day month", () => {
    expect(clampDayToMonth(31, 2026, 2)).toBe(31);
  });

  it("does not clamp mid-month days", () => {
    expect(clampDayToMonth(15, 2026, 5)).toBe(15);
  });

  it("always returns 1 for day 1", () => {
    expect(clampDayToMonth(1, 2027, 1)).toBe(1);
  });
});

describe("distributeSplitAcrossWeeks", () => {
  it("distributes proportionally to leftover room", () => {
    const res = distributeSplitAcrossWeeks(10000, [15000, 20000, 15000, 30000, 20000]);
    // 100.00 total, room shares 15/20/15/30/20 → 15/20/15/30/20 cents each.
    expect(res.perWeekCents).toEqual([1500, 2000, 1500, 3000, 2000]);
    expect(res.unallocatedCents).toBe(0);
  });

  it("sums exactly to totalCents when room permits (largest-remainder rounding)", () => {
    // 100 cents across 3 weeks with equal room; ideal share = 33.33 each.
    // Largest-remainder gives two weeks 33, one week 34 — total = 100.
    const res = distributeSplitAcrossWeeks(100, [1000, 1000, 1000]);
    expect(res.perWeekCents.reduce((a, b) => a + b, 0)).toBe(100);
    expect(res.unallocatedCents).toBe(0);
  });

  it("caps at total room and reports unallocated", () => {
    // Try to save $500 but only $300 of leftover room across all weeks.
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

  it("returns all zeros when total is 0", () => {
    const res = distributeSplitAcrossWeeks(0, [1000, 1000]);
    expect(res.perWeekCents).toEqual([0, 0]);
    expect(res.unallocatedCents).toBe(0);
  });

  it("returns all zeros when every week has zero room", () => {
    const res = distributeSplitAcrossWeeks(1000, [0, 0, 0]);
    expect(res.perWeekCents).toEqual([0, 0, 0]);
    expect(res.unallocatedCents).toBe(1000);
  });
});

describe("monthKeyOf", () => {
  it("formats to YYYY-MM with zero-padded month", () => {
    expect(monthKeyOf(2026, 0)).toBe("2026-01");
    expect(monthKeyOf(2026, 8)).toBe("2026-09");
    expect(monthKeyOf(2026, 11)).toBe("2026-12");
  });
});

describe("getBillPeriodKeyWithOverride", () => {
  const periods = getPayPeriodsForMonth(2026, 8, WED); // Sept 2026: 5 periods
  const mk = monthKeyOf(2026, 8);

  it("uses the override when one is set for the (billId, monthKey)", () => {
    const overrides = [{ billId: "b1", monthKey: mk, weekIndex: 2 }];
    expect(getBillPeriodKeyWithOverride("b1", 30, periods, mk, overrides)).toBe("P3");
  });

  it("falls back to auto-attribution when no override matches", () => {
    const overrides = [
      { billId: "other", monthKey: mk, weekIndex: 0 },
      { billId: "b1", monthKey: "2026-08", weekIndex: 0 },
    ];
    // Bill due 30 in Sept: auto lands in P5 (30 in-month occurrence).
    expect(getBillPeriodKeyWithOverride("b1", 30, periods, mk, overrides)).toBe("P5");
  });

  it("ignores an override whose weekIndex is out of range", () => {
    const overrides = [{ billId: "b1", monthKey: mk, weekIndex: 99 }];
    expect(getBillPeriodKeyWithOverride("b1", 30, periods, mk, overrides)).toBe("P5");
  });
});

describe("balanceBillsGreedy — Sept 2026 rescue of over-loaded P5", () => {
  const periods = getPayPeriodsForMonth(2026, 8, WED); // 5 periods
  // periods: P1 Sep 2-8, P2 Sep 9-15, P3 Sep 16-22, P4 Sep 23-29, P5 Sep 30 – Oct 6

  const bills = [
    { id: "billShield", amount: 156.38, dueDate: 30 },
    { id: "claude", amount: 20.0, dueDate: 30 },
    { id: "bread", amount: 110.32, dueDate: 1 },
    { id: "starlink", amount: 130.0, dueDate: 4 },
    { id: "lifeIns", amount: 58.27, dueDate: 4 },
    { id: "phone", amount: 101.0, dueDate: 5 },
  ];

  it("no bill's week exceeds (income - fixed - target) when feasible", () => {
    const result = balanceBillsGreedy({
      bills,
      periods,
      incomePerPeriodCents: [62000, 62000, 62000, 62000, 62000],
      fixedExpensesPerPeriodCents: [0, 0, 0, 0, 0],
      targetSurplusCents: 30000,
    });
    expect(result.feasible).toBe(true);
    // Each week must retain at least $300 surplus after bills.
    result.perWeekBillCents.forEach((cents) => expect(cents).toBeLessThanOrEqual(32000));
  });

  it("all six bills are assigned to some week", () => {
    const result = balanceBillsGreedy({
      bills,
      periods,
      incomePerPeriodCents: [62000, 62000, 62000, 62000, 62000],
      fixedExpensesPerPeriodCents: [0, 0, 0, 0, 0],
      targetSurplusCents: 30000,
    });
    expect(result.assignments).toHaveLength(6);
    expect(result.unplaced).toHaveLength(0);
  });

  it("respects payday-<=-due-date eligibility — bill Shield due Sep 30 can go to P1..P5", () => {
    const result = balanceBillsGreedy({
      bills: [{ id: "billShield", amount: 156.38, dueDate: 30 }],
      periods,
      incomePerPeriodCents: [62000, 62000, 62000, 62000, 62000],
      fixedExpensesPerPeriodCents: [0, 0, 0, 0, 0],
      targetSurplusCents: 0,
    });
    // With empty budgets and equal room, best-fit-decreasing picks the lowest
    // index — but the key invariant is that eligible weeks include ALL five.
    expect(result.assignments[0].weekIndex).toBeGreaterThanOrEqual(0);
    expect(result.assignments[0].weekIndex).toBeLessThanOrEqual(4);
  });

  it("marks feasible=false when total bills exceed total budget", () => {
    const result = balanceBillsGreedy({
      bills,
      periods,
      incomePerPeriodCents: [10000, 10000, 10000, 10000, 10000], // only $100/wk
      fixedExpensesPerPeriodCents: [0, 0, 0, 0, 0],
      targetSurplusCents: 0,
    });
    expect(result.feasible).toBe(false);
  });
});
