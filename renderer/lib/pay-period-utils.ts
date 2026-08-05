const PERIOD_COLORS = ["#818cf8", "#ec4899", "#38bdf8", "#c084fc", "#f59e0b", "#22d3ee"];

export interface PayPeriod {
  key: string;
  index: number;
  /** Day-of-current-month coordinate for the period start. Always the day of
   * an in-month payday (>= 1). */
  startDay: number;
  /** Day-of-current-month coordinate for the period end. May exceed
   * daysInMonth when the period runs into next month (e.g. Sep 1 seen from
   * Aug is 32). */
  endDay: number;
  /** Number of days in the source month — needed by getBillPeriodKey so it
   * can convert a bill's day-of-month into the forward-extension coordinate
   * (D + daysInMonth) to attribute next-month occurrences to this month's
   * funding paycheck. */
  daysInMonth: number;
  isPaydayStart: boolean;
  firstPaydayOfMonth: number;
  label: string;
  dateRange: string;
  isCurrent: boolean;
  color: string;
}

/**
 * Returns the pay periods that BELONG TO a given month — i.e. one per payday
 * that lands in the month. Each period starts on its payday and ends the day
 * before the next payday. The final period extends forward through the day
 * before the next month's first payday, so bills funded from this month's
 * last paycheck (which land in early next-month days) are attributed here.
 *
 * There is intentionally no backward extension: a payday in July "belongs" to
 * July even when the pay week it starts runs into August. Bills due Aug 1-4
 * are funded from Jul 29's paycheck and thus surface under July's view, not
 * August's — matching how the user thinks about the money.
 */
export function getPayPeriodsForMonth(
  year: number,
  month: number,
  payWeekday: number,
  today?: Date,
  biWeekly?: boolean,
): PayPeriod[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const reference = today ?? new Date();

  const listPayDays = (y: number, m: number): number[] => {
    const dim = new Date(y, m + 1, 0).getDate();
    const days: number[] = [];
    for (let d = 1; d <= dim; d++) {
      if (new Date(y, m, d).getDay() === payWeekday) days.push(d);
    }
    if (!biWeekly) return days;
    return days.filter((_, i) => i % 2 === 0);
  };

  const monthPayDays = listPayDays(year, month);
  if (monthPayDays.length === 0) return [];

  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextMonthPayDays = listPayDays(nextYear, nextMonth);
  const nextFirstPayday =
    nextMonthPayDays.length > 0 ? nextMonthPayDays[0] : null;

  const starts: number[] = [...monthPayDays];
  const ends: number[] = starts.slice(1).map((s) => s - 1);
  // Forward-extend the last period. If next month starts on a payday, no
  // extension is needed (that payday defines its own P1 in next month's view).
  if (nextFirstPayday != null && nextFirstPayday > 1) {
    ends.push(daysInMonth + (nextFirstPayday - 1));
  } else {
    ends.push(daysInMonth);
  }

  const monthAbbr = new Date(year, month, 1).toLocaleString("default", {
    month: "short",
  });
  const nextMonthAbbr = new Date(nextYear, nextMonth, 1).toLocaleString(
    "default",
    { month: "short" },
  );

  return starts.map((startDay, i) => {
    const endDay = ends[i];

    const startLabel = `${monthAbbr} ${startDay}`;
    const endLabel =
      endDay > daysInMonth
        ? `${nextMonthAbbr} ${endDay - daysInMonth}`
        : `${monthAbbr} ${endDay}`;
    const dateRange =
      startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;

    const refY = reference.getFullYear();
    const refM = reference.getMonth();
    const refD = reference.getDate();
    let isCurrent = false;

    if (refY === year && refM === month) {
      const endInMonth = Math.min(endDay, daysInMonth);
      if (refD >= startDay && refD <= endInMonth) isCurrent = true;
    }
    if (!isCurrent && endDay > daysInMonth) {
      const endInNext = endDay - daysInMonth;
      if (refY === nextYear && refM === nextMonth && refD <= endInNext) {
        isCurrent = true;
      }
    }

    return {
      key: `P${i + 1}`,
      index: i,
      startDay,
      endDay,
      daysInMonth,
      isPaydayStart: true,
      firstPaydayOfMonth: monthPayDays[0],
      label: `Pay Week ${i + 1}`,
      dateRange,
      isCurrent,
      color: PERIOD_COLORS[i] ?? PERIOD_COLORS[PERIOD_COLORS.length - 1],
    };
  });
}

export function clampDayToMonth(day: number, year: number, month: number): number {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return Math.min(day, daysInMonth);
}

/**
 * Returns the period key that a monthly-recurring bill should surface under,
 * or null if no period in this month's view funds the bill (in which case it
 * belongs to a different month's view).
 *
 * A bill with dueDate D can be funded by one of the month's paychecks in two
 * ways:
 *  1. Its NEXT-MONTH occurrence (day D of next month, coord D + daysInMonth)
 *     falls in the last period's forward extension — this is preferred, since
 *     it's how the user thinks: "Jul 29's paycheck pays Aug 1's Bread."
 *  2. Its IN-MONTH occurrence (day D of this month) falls in some period —
 *     the fallback for bills that fire mid-cycle from an in-month paycheck.
 * Case 1 takes precedence so bills near month boundaries land under the
 * paycheck that actually funds them.
 */
export function getBillPeriodKey(
  dueDate: number,
  periods: PayPeriod[],
): string | null {
  if (periods.length === 0) return null;
  const daysInMonth = periods[0].daysInMonth;
  const nextMonthCoord = dueDate + daysInMonth;

  for (const p of periods) {
    if (nextMonthCoord >= p.startDay && nextMonthCoord <= p.endDay) {
      return p.key;
    }
  }
  for (const p of periods) {
    if (dueDate >= p.startDay && dueDate <= p.endDay) return p.key;
  }
  return null;
}

/**
 * Month-key ("YYYY-MM") derived from a view's year/month. Used to identify
 * per-month bill overrides (BillPayWeekOverride.monthKey).
 */
export function monthKeyOf(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export interface BillOverrideRecord {
  billId: string;
  monthKey: string;
  weekIndex: number;
}

/**
 * Same as getBillPeriodKey but consults an overrides list first. When an
 * override exists for (billId, monthKey) AND the target weekIndex is valid
 * for the current periods list, the override wins.
 */
export function getBillPeriodKeyWithOverride(
  billId: string,
  dueDate: number,
  periods: PayPeriod[],
  monthKey: string,
  overrides: BillOverrideRecord[],
): string | null {
  const override = overrides.find(
    (o) => o.billId === billId && o.monthKey === monthKey,
  );
  if (override) {
    const target = periods[override.weekIndex];
    if (target) return target.key;
  }
  return getBillPeriodKey(dueDate, periods);
}

export interface BillForBalance {
  id: string;
  amount: number; // dollars
  dueDate: number; // 1..31
}

export interface BalanceInputs {
  bills: BillForBalance[];
  periods: PayPeriod[];
  /** Income landing in each period, in cents, aligned with `periods` index. */
  incomePerPeriodCents: number[];
  /** Fixed (non-shiftable) expenses per period, in cents (e.g. personal). */
  fixedExpensesPerPeriodCents: number[];
  /** Minimum surplus each period should retain after bills + fixed expenses. */
  targetSurplusCents: number;
}

export interface BalanceAssignment {
  billId: string;
  weekIndex: number;
}

export interface BalanceResult {
  assignments: BalanceAssignment[];
  /** Total shiftable-bill cents finally landed in each period. */
  perWeekBillCents: number[];
  /** True when every bill was placed inside its period's remaining budget. */
  feasible: boolean;
  /** Bills whose occurrence falls outside this month's coverage window and
   * therefore weren't placed at all. Callers can surface these. */
  unplaced: string[];
}

/**
 * Best-fit-decreasing greedy: sort bills largest first, then place each in
 * the eligible period with the MOST remaining room. "Eligible" means the
 * period's payday is on or before the bill's occurrence day — you can't fund
 * a bill from a paycheck that hasn't landed yet.
 */
export function balanceBillsGreedy(inputs: BalanceInputs): BalanceResult {
  const {
    bills,
    periods,
    incomePerPeriodCents,
    fixedExpensesPerPeriodCents,
    targetSurplusCents,
  } = inputs;
  const N = periods.length;
  if (N === 0) {
    return {
      assignments: [],
      perWeekBillCents: [],
      feasible: bills.length === 0,
      unplaced: bills.map((b) => b.id),
    };
  }

  const daysInMonth = periods[0].daysInMonth;
  const firstStart = periods[0].startDay;
  const lastEnd = periods[N - 1].endDay;

  const occCoord = (dueDate: number): number | null => {
    const nextCoord = dueDate + daysInMonth;
    if (nextCoord >= firstStart && nextCoord <= lastEnd) return nextCoord;
    if (dueDate >= firstStart && dueDate <= lastEnd) return dueDate;
    return null;
  };

  const budget: number[] = periods.map(
    (_, i) =>
      (incomePerPeriodCents[i] ?? 0) -
      (fixedExpensesPerPeriodCents[i] ?? 0) -
      targetSurplusCents,
  );
  const perWeek: number[] = new Array(N).fill(0);

  const unplaced: string[] = [];
  const eligibleCount = (coord: number): number => {
    let n = 0;
    for (let i = 0; i < N; i++) if (periods[i].startDay <= coord) n++;
    return n;
  };
  const withCoord = bills
    .map((b) => ({ bill: b, coord: occCoord(b.dueDate) }))
    .filter((x) => {
      if (x.coord == null) {
        unplaced.push(x.bill.id);
        return false;
      }
      return true;
    })
    // Most-constrained first: bills eligible for the fewest weeks (early
    // due-dates that can only be funded by the first payday) go before more
    // flexible bills. Tiebreak on amount desc so larger bills still lead.
    .sort((a, b) => {
      const ea = eligibleCount(a.coord!);
      const eb = eligibleCount(b.coord!);
      if (ea !== eb) return ea - eb;
      return b.bill.amount - a.bill.amount;
    });

  const assignments: BalanceAssignment[] = [];
  let feasible = true;

  for (const { bill, coord } of withCoord) {
    const amountCents = Math.round(bill.amount * 100);
    let bestIdx = -1;
    let bestRoom = -Infinity;
    for (let i = 0; i < N; i++) {
      if (periods[i].startDay > coord!) continue;
      const room = budget[i] - perWeek[i];
      if (room > bestRoom) {
        bestRoom = room;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) {
      // Every eligible slot is impossibly early; shouldn't happen when coord is
      // valid, but if it does, drop the bill from the plan rather than crash.
      unplaced.push(bill.id);
      feasible = false;
      continue;
    }
    if (bestRoom < amountCents) feasible = false;
    assignments.push({ billId: bill.id, weekIndex: bestIdx });
    perWeek[bestIdx] += amountCents;
  }

  return { assignments, perWeekBillCents: perWeek, feasible, unplaced };
}

export interface SplitPersonalRef {
  id: string;
  /** Monthly total in dollars. */
  amount: number;
}

export interface SplitAllocationResult {
  /** Cents allocated per split id per period. */
  perSplitPerPeriod: Map<string, number[]>;
  /** Sum of split allocations per period (across all splits). */
  totalSplitPerPeriod: number[];
  /** Cents that couldn't fit into any period's leftover room, per split id. */
  unallocatedPerSplit: Map<string, number>;
}

/**
 * For a set of split personals, allocates each one's monthly total across the
 * given pay weeks proportional to the leftover room in each week (income
 * minus fixed personal, assigned bills, and the wife target). When multiple
 * splits are present, they are processed in descending-amount order so the
 * biggest split gets first pick of room — subsequent splits use what remains.
 */
export function computeSplitPersonalAllocations(params: {
  periods: PayPeriod[];
  incomePerPeriodCents: number[];
  fixedPersonalPerPeriodCents: number[];
  billsPerPeriodCents: number[];
  targetSurplusCents: number;
  splits: SplitPersonalRef[];
}): SplitAllocationResult {
  const {
    periods,
    incomePerPeriodCents,
    fixedPersonalPerPeriodCents,
    billsPerPeriodCents,
    targetSurplusCents,
    splits,
  } = params;
  const N = periods.length;
  const room = periods.map(
    (_, i) =>
      (incomePerPeriodCents[i] ?? 0) -
      (fixedPersonalPerPeriodCents[i] ?? 0) -
      (billsPerPeriodCents[i] ?? 0) -
      targetSurplusCents,
  );

  const perSplitPerPeriod = new Map<string, number[]>();
  const totalSplitPerPeriod = new Array(N).fill(0);
  const unallocatedPerSplit = new Map<string, number>();

  const ordered = [...splits].sort((a, b) => b.amount - a.amount);
  for (const s of ordered) {
    const totalCents = Math.round(s.amount * 100);
    const dist = distributeSplitAcrossWeeks(totalCents, room);
    perSplitPerPeriod.set(s.id, dist.perWeekCents);
    unallocatedPerSplit.set(s.id, dist.unallocatedCents);
    for (let i = 0; i < N; i++) {
      totalSplitPerPeriod[i] += dist.perWeekCents[i];
      room[i] -= dist.perWeekCents[i];
    }
  }

  return { perSplitPerPeriod, totalSplitPerPeriod, unallocatedPerSplit };
}

/**
 * Distributes a monthly total across pay weeks proportional to each week's
 * leftover room (income − fixed personal − assigned bills − wife target).
 *
 * - Any week with room <= 0 gets 0 (can't add more without breaching target).
 * - Weeks with room absorb a share proportional to their room, capped at their
 *   own room ceiling.
 * - If the total exceeds every week's combined room, we fill every week to
 *   capacity and return the leftover as `unallocatedCents`.
 * - Rounding: whole cents distributed via largest-remainder (Hamilton) so the
 *   per-week amounts sum EXACTLY to totalCents when feasible.
 */
export interface SplitDistribution {
  perWeekCents: number[];
  unallocatedCents: number;
}

export function distributeSplitAcrossWeeks(
  totalCents: number,
  roomPerWeekCents: number[],
): SplitDistribution {
  const N = roomPerWeekCents.length;
  if (N === 0) return { perWeekCents: [], unallocatedCents: totalCents };
  if (totalCents <= 0) return { perWeekCents: new Array(N).fill(0), unallocatedCents: 0 };

  const positiveRoom = roomPerWeekCents.map((r) => Math.max(0, r));
  const totalRoom = positiveRoom.reduce((a, b) => a + b, 0);

  if (totalRoom === 0) {
    return { perWeekCents: new Array(N).fill(0), unallocatedCents: totalCents };
  }

  // Cap total at what fits.
  const toAllocate = Math.min(totalCents, totalRoom);
  const unallocated = totalCents - toAllocate;

  // Ideal fractional share per week.
  const shares = positiveRoom.map((r) => (toAllocate * r) / totalRoom);
  // Floor + track remainders to distribute the last cents deterministically.
  const floors = shares.map((s) => Math.floor(s));
  let assigned = floors.reduce((a, b) => a + b, 0);
  let leftover = toAllocate - assigned;

  // Order indices by descending remainder; give +1 cent to the top `leftover`
  // weeks until we've placed every cent (capped at their room ceiling).
  const remainders = shares
    .map((s, i) => ({ i, frac: s - Math.floor(s), room: positiveRoom[i] }))
    .sort((a, b) => b.frac - a.frac);

  const result = [...floors];
  for (const { i, room } of remainders) {
    if (leftover <= 0) break;
    if (result[i] < room) {
      result[i] += 1;
      leftover -= 1;
    }
  }
  // Edge case: if rounding pushed some weeks past their room, spill back.
  for (let i = 0; i < N && leftover < 0; i++) {
    // Should not happen because floors never exceed shares; kept for safety.
    result[i] = Math.max(0, result[i] - 1);
    leftover += 1;
  }

  return { perWeekCents: result, unallocatedCents: unallocated };
}

export interface BillOccurrenceInPeriod {
  /** Day-of-current-month coordinate for the occurrence; > daysInMonth means
   * the bill fires in the following month (P forward-extension). */
  coord: number;
  /** True when the occurrence lands in the next month (forward extension). */
  inNextMonth: boolean;
  /** The calendar day of the actual occurrence (1..31 in either month). */
  day: number;
}

/**
 * Returns the concrete calendar occurrence for a monthly-recurring bill within
 * a period, or null if the bill doesn't fire in this period. Callers use
 * `coord` to sort chronologically inside a period card and `inNextMonth` to
 * decide whether to prefix the subtitle with next-month's abbreviation
 * (e.g. "Due Oct 1st" vs "Due on the 30th").
 */
export function getBillOccurrenceInPeriod(
  dueDate: number,
  period: PayPeriod,
): BillOccurrenceInPeriod | null {
  const nextMonthCoord = dueDate + period.daysInMonth;
  if (nextMonthCoord >= period.startDay && nextMonthCoord <= period.endDay) {
    return { coord: nextMonthCoord, inNextMonth: true, day: dueDate };
  }
  if (dueDate >= period.startDay && dueDate <= period.endDay) {
    return { coord: dueDate, inNextMonth: false, day: dueDate };
  }
  return null;
}
