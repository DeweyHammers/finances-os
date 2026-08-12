import { describe, it, expect } from "vitest";
import {
  monthKey,
  prevMonth,
  monthStart,
  isInMonth,
  computeActivity,
  computeAvailable,
  computeReadyToAssign,
  computeAccountBalance,
  resolveAutoAssignAmount,
  resolveAutoAssignAmountForPeriod,
  moveMoney,
  buildBalanceAdjustment,
} from "./budget-utils";
import { getPayPeriodsForMonth } from "./pay-period-utils";

describe("monthKey", () => {
  it("returns YYYY-MM in UTC", () => {
    expect(monthKey("2026-05-15T00:00:00Z")).toBe("2026-05");
    expect(monthKey("2026-01-01T00:00:00Z")).toBe("2026-01");
    expect(monthKey("2026-12-31T23:59:59Z")).toBe("2026-12");
  });

  it("uses UTC, not local time", () => {
    // Even on a timezone where local time would shift the day, UTC stays put
    expect(monthKey(new Date(Date.UTC(2026, 4, 1)))).toBe("2026-05");
  });
});

describe("prevMonth", () => {
  it("steps back one month, snapping to the 1st", () => {
    const d = prevMonth(new Date(Date.UTC(2026, 4, 15)));
    expect(d.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("crosses year boundary", () => {
    const d = prevMonth(new Date(Date.UTC(2026, 0, 1)));
    expect(d.toISOString()).toBe("2025-12-01T00:00:00.000Z");
  });
});

describe("monthStart", () => {
  it("snaps any date to first of its month UTC", () => {
    expect(monthStart("2026-05-15T18:00:00Z").toISOString()).toBe(
      "2026-05-01T00:00:00.000Z",
    );
  });
});

describe("isInMonth", () => {
  it("true when same year-month", () => {
    expect(isInMonth("2026-05-15", "2026-05-01")).toBe(true);
  });

  it("false when different month", () => {
    expect(isInMonth("2026-04-30", "2026-05-01")).toBe(false);
  });
});

describe("computeActivity", () => {
  it("sums outflow minus inflow for matching item in matching month", () => {
    const txns = [
      {
        date: "2026-05-10",
        categoryItemId: "a",
        inflowCents: 0,
        outflowCents: 1000,
      },
      {
        date: "2026-05-20",
        categoryItemId: "a",
        inflowCents: 0,
        outflowCents: 500,
      },
    ];
    expect(computeActivity(txns, "a", "2026-05-01")).toBe(1500);
  });

  it("subtracts inflows (refunds) from outflows", () => {
    const txns = [
      {
        date: "2026-05-10",
        categoryItemId: "a",
        inflowCents: 0,
        outflowCents: 1000,
      },
      {
        date: "2026-05-15",
        categoryItemId: "a",
        inflowCents: 200,
        outflowCents: 0,
      },
    ];
    expect(computeActivity(txns, "a", "2026-05-01")).toBe(800);
  });

  it("ignores transactions in other months", () => {
    const txns = [
      {
        date: "2026-04-30",
        categoryItemId: "a",
        inflowCents: 0,
        outflowCents: 1000,
      },
      {
        date: "2026-06-01",
        categoryItemId: "a",
        inflowCents: 0,
        outflowCents: 1000,
      },
    ];
    expect(computeActivity(txns, "a", "2026-05-01")).toBe(0);
  });

  it("ignores transactions for other items", () => {
    const txns = [
      {
        date: "2026-05-10",
        categoryItemId: "b",
        inflowCents: 0,
        outflowCents: 1000,
      },
    ];
    expect(computeActivity(txns, "a", "2026-05-01")).toBe(0);
  });

  it("returns 0 for empty input", () => {
    expect(computeActivity([], "a", "2026-05-01")).toBe(0);
  });
});

describe("computeAvailable", () => {
  it("rolls forward positive prior", () => {
    expect(
      computeAvailable({
        priorAvailable: 500,
        assignedCents: 1000,
        activityCents: 300,
      }),
    ).toBe(1200);
  });

  it("zeroes out negative prior (cash overspending absorbed by RTA)", () => {
    expect(
      computeAvailable({
        priorAvailable: -500,
        assignedCents: 1000,
        activityCents: 300,
      }),
    ).toBe(700);
  });

  it("can go negative when activity exceeds assigned + carry", () => {
    expect(
      computeAvailable({
        priorAvailable: 0,
        assignedCents: 100,
        activityCents: 500,
      }),
    ).toBe(-400);
  });
});

describe("computeReadyToAssign", () => {
  it("uncategorized inflows minus assignments", () => {
    const txns = [
      {
        date: "2026-05-01",
        categoryItemId: null,
        inflowCents: 500000,
        outflowCents: 0,
      },
    ];
    const assignments = [{ assignedCents: 100000 }, { assignedCents: 50000 }];
    expect(computeReadyToAssign({ transactions: txns, assignments })).toBe(
      350000,
    );
  });

  it("subtracts uncategorized outflows (negative balance adjustments)", () => {
    const txns = [
      {
        date: "2026-05-01",
        categoryItemId: null,
        inflowCents: 100000,
        outflowCents: 0,
      },
      {
        date: "2026-05-02",
        categoryItemId: null,
        inflowCents: 0,
        outflowCents: 30000,
      },
    ];
    expect(
      computeReadyToAssign({ transactions: txns, assignments: [] }),
    ).toBe(70000);
  });

  it("ignores categorized transactions", () => {
    const txns = [
      {
        date: "2026-05-01",
        categoryItemId: null,
        inflowCents: 100000,
        outflowCents: 0,
      },
      {
        date: "2026-05-02",
        categoryItemId: "x",
        inflowCents: 0,
        outflowCents: 30000,
      },
    ];
    expect(
      computeReadyToAssign({ transactions: txns, assignments: [] }),
    ).toBe(100000);
  });

  it("returns 0 for nothing", () => {
    expect(
      computeReadyToAssign({ transactions: [], assignments: [] }),
    ).toBe(0);
  });
});

describe("computeAccountBalance", () => {
  it("sums inflow minus outflow", () => {
    expect(
      computeAccountBalance([
        { inflowCents: 50000, outflowCents: 0 },
        { inflowCents: 0, outflowCents: 1500 },
        { inflowCents: 0, outflowCents: 2500 },
      ]),
    ).toBe(46000);
  });

  it("returns 0 for no transactions", () => {
    expect(computeAccountBalance([])).toBe(0);
  });
});

describe("resolveAutoAssignAmount", () => {
  const bills = [
    { id: "b1", amount: 26.99, withdrawalCycle: "Q4" },
    { id: "b2", amount: 110.32, withdrawalCycle: "Q1" },
  ];
  const personals = [
    { name: "Gas", amount: 50, withdrawalCycle: "Q1" },
    { name: "Gas", amount: 50, withdrawalCycle: "Q2" },
    { name: "Gas", amount: 50, withdrawalCycle: "Q3" },
    { name: "Gas", amount: 50, withdrawalCycle: "Q4" },
  ];

  it("BILL: matching cycle returns amount in cents", () => {
    const item = {
      id: "i1",
      sourceType: "BILL" as const,
      sourceBillId: "b1",
    };
    expect(
      resolveAutoAssignAmount({ item, cycle: "Q4", bills, personals }),
    ).toBe(2699);
  });

  it("BILL: non-matching cycle returns 0", () => {
    const item = {
      id: "i1",
      sourceType: "BILL" as const,
      sourceBillId: "b1",
    };
    expect(
      resolveAutoAssignAmount({ item, cycle: "Q1", bills, personals }),
    ).toBe(0);
  });

  it("BILL: missing bill returns 0", () => {
    const item = {
      id: "i1",
      sourceType: "BILL" as const,
      sourceBillId: "missing",
    };
    expect(
      resolveAutoAssignAmount({ item, cycle: "Q1", bills, personals }),
    ).toBe(0);
  });

  it("PERSONAL_NAME: returns matching cycle amount", () => {
    const item = {
      id: "i1",
      sourceType: "PERSONAL_NAME" as const,
      sourcePersonalName: "Gas",
    };
    expect(
      resolveAutoAssignAmount({ item, cycle: "Q3", bills, personals }),
    ).toBe(5000);
  });

  it("PERSONAL_NAME: returns 0 if no match for cycle", () => {
    const item = {
      id: "i1",
      sourceType: "PERSONAL_NAME" as const,
      sourcePersonalName: "Groceries",
    };
    expect(
      resolveAutoAssignAmount({ item, cycle: "Q1", bills, personals }),
    ).toBe(0);
  });

  it("CUSTOM: matching cycle returns customAmount", () => {
    const item = {
      id: "i1",
      sourceType: "CUSTOM" as const,
      customAmountCents: 12000,
      customCycle: "Q2",
    };
    expect(
      resolveAutoAssignAmount({ item, cycle: "Q2", bills, personals }),
    ).toBe(12000);
  });

  it("CUSTOM: customCycle null assigns regardless of cycle", () => {
    const item = {
      id: "i1",
      sourceType: "CUSTOM" as const,
      customAmountCents: 12000,
      customCycle: null,
    };
    expect(
      resolveAutoAssignAmount({ item, cycle: "Q1", bills, personals }),
    ).toBe(12000);
    expect(
      resolveAutoAssignAmount({ item, cycle: "Q4", bills, personals }),
    ).toBe(12000);
  });

  it("CUSTOM: non-matching cycle returns 0", () => {
    const item = {
      id: "i1",
      sourceType: "CUSTOM" as const,
      customAmountCents: 12000,
      customCycle: "Q2",
    };
    expect(
      resolveAutoAssignAmount({ item, cycle: "Q3", bills, personals }),
    ).toBe(0);
  });

  it("CUSTOM: null customAmountCents returns 0", () => {
    const item = {
      id: "i1",
      sourceType: "CUSTOM" as const,
      customAmountCents: null,
      customCycle: "Q1",
    };
    expect(
      resolveAutoAssignAmount({ item, cycle: "Q1", bills, personals }),
    ).toBe(0);
  });
});

describe("resolveAutoAssignAmountForPeriod", () => {
  // August 2026: Wednesdays land on 5, 12, 19, 26 → 4 pay weeks
  // P1 = Aug 5-11, P2 = Aug 12-18, P3 = Aug 19-25, P4 = Aug 26 – (Sep 1 = coord 32)
  const periods = getPayPeriodsForMonth(2026, 7, 3, new Date(2026, 7, 5), false);

  it("BILL: uses split allocation to attribute a late-due bill to an earlier period", () => {
    // Discord due on the 17th naturally lands in P2; auto-balance wrote a
    // single-row split placing it at Pay Week 1 (weekIndex 0). Auto-assign
    // for P1 should now see it.
    const bill = { id: "discord", amount: 9.99, dueDate: 17 };
    const item = {
      id: "i-discord",
      sourceType: "BILL" as const,
      sourceBillId: "discord",
    };
    const splits = [
      { billId: "discord", monthKey: "2026-08", weekIndex: 0, amountCents: 999 },
    ];

    expect(
      resolveAutoAssignAmountForPeriod({
        item,
        periodKey: "P1",
        periods,
        bills: [bill],
        personals: [],
        splits,
        monthKey: "2026-08",
      }),
    ).toBe(999);

    // And P2 (the natural period) no longer claims it.
    expect(
      resolveAutoAssignAmountForPeriod({
        item,
        periodKey: "P2",
        periods,
        bills: [bill],
        personals: [],
        splits,
        monthKey: "2026-08",
      }),
    ).toBe(0);
  });

  it("BILL: split across two weeks returns per-week cents in each period", () => {
    const bill = { id: "climb", amount: 200, dueDate: 15 };
    const item = {
      id: "i-climb",
      sourceType: "BILL" as const,
      sourceBillId: "climb",
    };
    const splits = [
      { billId: "climb", monthKey: "2026-08", weekIndex: 0, amountCents: 8000 },
      { billId: "climb", monthKey: "2026-08", weekIndex: 1, amountCents: 12000 },
    ];
    expect(
      resolveAutoAssignAmountForPeriod({
        item, periodKey: "P1", periods,
        bills: [bill], personals: [], splits, monthKey: "2026-08",
      }),
    ).toBe(8000);
    expect(
      resolveAutoAssignAmountForPeriod({
        item, periodKey: "P2", periods,
        bills: [bill], personals: [], splits, monthKey: "2026-08",
      }),
    ).toBe(12000);
    expect(
      resolveAutoAssignAmountForPeriod({
        item, periodKey: "P3", periods,
        bills: [bill], personals: [], splits, monthKey: "2026-08",
      }),
    ).toBe(0);
  });

  it("BILL: falls back to natural due-date attribution when no split matches", () => {
    const bill = { id: "phone", amount: 101, dueDate: 5 };
    const item = {
      id: "i-phone",
      sourceType: "BILL" as const,
      sourceBillId: "phone",
    };
    expect(
      resolveAutoAssignAmountForPeriod({
        item,
        periodKey: "P1",
        periods,
        bills: [bill],
        personals: [],
        splits: [],
        monthKey: "2026-08",
      }),
    ).toBe(10100);
  });

  it("PERSONAL_NAME split: uses pre-computed split allocation for this period", () => {
    // Saving is a split personal ($100/mo). The Overview computes the P1
    // slice to be $12.15 given the current room; auto-assign should return
    // that cumulative-through-P1 amount, not the full monthly total.
    const item = {
      id: "i-saving",
      sourceType: "PERSONAL_NAME" as const,
      sourcePersonalName: "Saving",
    };
    const personals = [
      {
        name: "Saving",
        amount: 100,
        dueDate: 1,
        splitAcrossWeeks: true,
        repeatWeekly: false,
      },
    ];
    expect(
      resolveAutoAssignAmountForPeriod({
        item,
        periodKey: "P1",
        periods,
        bills: [],
        personals,
        splitAllocationsByPersonalName: { Saving: 1215 },
      }),
    ).toBe(1215);
  });

  it("PERSONAL_NAME split: returns 0 when no allocation is registered", () => {
    const item = {
      id: "i-saving",
      sourceType: "PERSONAL_NAME" as const,
      sourcePersonalName: "Saving",
    };
    const personals = [
      {
        name: "Saving",
        amount: 100,
        dueDate: 1,
        splitAcrossWeeks: true,
        repeatWeekly: false,
      },
    ];
    expect(
      resolveAutoAssignAmountForPeriod({
        item,
        periodKey: "P1",
        periods,
        bills: [],
        personals,
      }),
    ).toBe(0);
  });

  it("PERSONAL_NAME weekOfMonth: attributes to Pk regardless of dueDate", () => {
    const item = {
      id: "i-gas",
      sourceType: "PERSONAL_NAME" as const,
      sourcePersonalName: "Gas",
    };
    const personals = [
      {
        name: "Gas",
        amount: 50,
        dueDate: 1,
        weekOfMonth: 3,
        repeatWeekly: false,
      },
    ];
    expect(
      resolveAutoAssignAmountForPeriod({
        item,
        periodKey: "P3",
        periods,
        bills: [],
        personals,
      }),
    ).toBe(5000);
    expect(
      resolveAutoAssignAmountForPeriod({
        item,
        periodKey: "P1",
        periods,
        bills: [],
        personals,
      }),
    ).toBe(0);
  });

  it("PERSONAL_NAME repeatWeekly still returns amount each period", () => {
    const item = {
      id: "i-spend",
      sourceType: "PERSONAL_NAME" as const,
      sourcePersonalName: "Spending",
    };
    const personals = [
      {
        name: "Spending",
        amount: 20,
        dueDate: 1,
        repeatWeekly: true,
      },
    ];
    for (const key of ["P1", "P2", "P3", "P4"]) {
      expect(
        resolveAutoAssignAmountForPeriod({
          item,
          periodKey: key,
          periods,
          bills: [],
          personals,
        }),
      ).toBe(2000);
    }
  });
});

describe("moveMoney", () => {
  it("returns symmetrical deltas", () => {
    const r = moveMoney({
      sourceItemId: "a",
      destItemId: "b",
      amountCents: 5000,
    });
    expect(r.sourceDelta).toBe(-5000);
    expect(r.destDelta).toBe(5000);
  });

  it("throws when source equals dest", () => {
    expect(() =>
      moveMoney({ sourceItemId: "a", destItemId: "a", amountCents: 100 }),
    ).toThrow();
  });

  it("throws on non-positive amount", () => {
    expect(() =>
      moveMoney({ sourceItemId: "a", destItemId: "b", amountCents: 0 }),
    ).toThrow();
    expect(() =>
      moveMoney({ sourceItemId: "a", destItemId: "b", amountCents: -1 }),
    ).toThrow();
    expect(() =>
      moveMoney({ sourceItemId: "a", destItemId: "b", amountCents: NaN }),
    ).toThrow();
  });
});

describe("buildBalanceAdjustment", () => {
  it("creates inflow when new > current", () => {
    const r = buildBalanceAdjustment({
      accountId: "acc",
      currentBalanceCents: 100000,
      newBalanceCents: 150000,
    });
    expect(r).toEqual({
      accountId: "acc",
      payeeId: null,
      isAdjustment: true,
      inflowCents: 50000,
      outflowCents: 0,
      categoryItemId: null,
      cleared: true,
    });
  });

  it("creates outflow when new < current", () => {
    const r = buildBalanceAdjustment({
      accountId: "acc",
      currentBalanceCents: 100000,
      newBalanceCents: 70000,
    });
    expect(r?.inflowCents).toBe(0);
    expect(r?.outflowCents).toBe(30000);
  });

  it("returns null when balances are equal", () => {
    expect(
      buildBalanceAdjustment({
        accountId: "acc",
        currentBalanceCents: 100,
        newBalanceCents: 100,
      }),
    ).toBeNull();
  });
});
