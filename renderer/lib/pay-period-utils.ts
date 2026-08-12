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

  // Orphan fallback: the bill fires early in the month (before the first
  // payday) AND its next-month occurrence is just past the forward-extension
  // window (because next month's first payday arrives before the due date).
  // The last paycheck of this month is the closest one to fund it, so
  // attribute to the last period so it's never invisible.
  const lastPeriod = periods[periods.length - 1];
  if (dueDate < periods[0].startDay && nextMonthCoord > lastPeriod.endDay) {
    return lastPeriod.key;
  }

  return null;
}

/**
 * Month-key ("YYYY-MM") derived from a view's year/month. Used to identify
 * per-month bill splits (BillSplit.monthKey).
 */
export function monthKeyOf(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export interface BillSplitRecord {
  billId: string;
  monthKey: string;
  weekIndex: number;
  amountCents: number;
}

export interface BillAllocation {
  weekIndex: number;
  periodKey: string;
  amountCents: number;
  /** True when this allocation is one of ≥ 2 rows for the same bill in the same month. */
  isSplit: boolean;
}

/**
 * Returns every pay-week allocation for a given bill within the current month
 * view. When BillSplit rows exist for (billId, monthKey) they win — an
 * unsplit bill appears as a single 1-row allocation. When no splits exist
 * (auto-balance hasn't run yet, or the row was never created), falls back to
 * the natural due-date attribution with the full bill amount, so the bill
 * still surfaces somewhere.
 */
export function getBillAllocationsForBill(
  billId: string,
  dueDate: number,
  amountDollars: number,
  periods: PayPeriod[],
  monthKey: string,
  splits: BillSplitRecord[],
): BillAllocation[] {
  const forBill = splits
    .filter((s) => s.billId === billId && s.monthKey === monthKey)
    .filter((s) => s.weekIndex >= 0 && s.weekIndex < periods.length)
    .sort((a, b) => a.weekIndex - b.weekIndex);

  if (forBill.length > 0) {
    const isSplit = forBill.length > 1;
    return forBill.map((s) => ({
      weekIndex: s.weekIndex,
      periodKey: periods[s.weekIndex].key,
      amountCents: s.amountCents,
      isSplit,
    }));
  }

  const naturalKey = getBillPeriodKey(dueDate, periods);
  if (naturalKey == null) return [];
  const naturalIdx = periods.findIndex((p) => p.key === naturalKey);
  return [
    {
      weekIndex: naturalIdx,
      periodKey: naturalKey,
      amountCents: Math.round(amountDollars * 100),
      isSplit: false,
    },
  ];
}

/**
 * Returns the week index (0-based) that a bill naturally falls into for the
 * given period list. Uses the same occurrence-coordinate logic as
 * balancePayWeeks Phase 1, so the result matches what the algorithm considers
 * the "home" week for a bill. Returns null when the bill has no occurrence
 * visible in this month's window.
 */
export function getBillNaturalWeekIndex(
  dueDate: number,
  periods: PayPeriod[],
): number | null {
  if (periods.length === 0) return null;
  const daysInMonth = periods[0].daysInMonth;
  const firstStart = periods[0].startDay;
  const lastEnd = periods[periods.length - 1].endDay;
  const nextCoord = dueDate + daysInMonth;
  let coord: number | null = null;
  if (nextCoord >= firstStart && nextCoord <= lastEnd) coord = nextCoord;
  else if (dueDate >= firstStart && dueDate <= lastEnd) coord = dueDate;
  else if (dueDate < firstStart && nextCoord > lastEnd) coord = nextCoord;
  if (coord == null) return null;
  for (let i = 0; i < periods.length; i++) {
    if (coord >= periods[i].startDay && coord <= periods[i].endDay) return i;
  }
  return periods.length - 1;
}

/**
 * Returns the cents this bill contributes to a specific period (0 if none).
 * Handles both split (from BillSplit rows) and un-split (natural attribution).
 */
export function getBillAllocationCentsForPeriod(
  billId: string,
  dueDate: number,
  amountDollars: number,
  periods: PayPeriod[],
  monthKey: string,
  splits: BillSplitRecord[],
  periodKey: string,
): number {
  const allocs = getBillAllocationsForBill(
    billId,
    dueDate,
    amountDollars,
    periods,
    monthKey,
    splits,
  );
  const hit = allocs.find((a) => a.periodKey === periodKey);
  return hit ? hit.amountCents : 0;
}

export interface BillForBalance {
  id: string;
  amount: number; // dollars
  dueDate: number; // 1..31
  /** When true, auto-balance never splits this bill across pay weeks. */
  neverSplit?: boolean;
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
  /** Day-of-month coordinate for "today" in this month's view (pass 0 or omit
   * for future months where no locking applies). Any period whose endDay is
   * strictly less than this value is "past" — its allocations are frozen and
   * the algorithm will not touch them. */
  todayCoord?: number;
  /** Existing BillSplit rows for past/locked periods. These are pre-credited
   * into perWeek as fixed costs and reduce each bill's remaining amount. The
   * algorithm never outputs allocations for locked weeks. */
  lockedAllocations?: BalanceAllocation[];
}

export interface BalanceAllocation {
  billId: string;
  weekIndex: number;
  amountCents: number;
}

export interface BalanceResult {
  /** One row per (bill, week) with the cents that pay-week gets. Un-split
   * bills produce exactly one row with amountCents = bill total. Split bills
   * produce ≥ 2 rows summing to the bill total. */
  allocations: BalanceAllocation[];
  /** Total bill cents finally landed in each period (sum of allocations). */
  perWeekBillCents: number[];
  /** True when every pay week's surplus meets or exceeds the target. */
  feasible: boolean;
  /** Bills whose occurrence falls outside this month's coverage window and
   * therefore weren't placed at all. Callers can surface these. */
  unplaced: string[];
}

/** Below this threshold, don't consider a bill for auto-splitting — showing
 * a $6 bill as $1.50 across four weeks is worse UX than one $6 lump. */
export const MIN_SPLIT_CENTS = 2500;

/**
 * Distributes `amountCents` across eligible weeks so that TOTAL bills per
 * week land as level as possible. `existingBillsCents` is what each eligible
 * week already has (in cents, excluding the bill we're distributing).
 *
 * Algorithm: iterative water-fill. Target = mean of (existing + amount) across
 * eligible weeks. Weeks already above target get 0; excluded and re-averaged.
 * Remaining weeks each get (target - existing) — sums to amountCents exactly
 * (in real numbers). Whole-cent rounding via largest-remainder.
 */
export function distributeBillLevel(
  amountCents: number,
  existingBillsCents: number[],
): number[] {
  const N = existingBillsCents.length;
  if (N === 0) return [];
  if (amountCents <= 0) return new Array(N).fill(0);

  const included = new Set<number>();
  for (let i = 0; i < N; i++) included.add(i);

  // Iteratively exclude weeks that would need a negative allocation to hit
  // the level target (i.e., their existing bills already exceed the mean).
  while (included.size > 0) {
    let sum = 0;
    for (const i of included) sum += existingBillsCents[i];
    const target = (sum + amountCents) / included.size;
    let excluded = false;
    for (const i of Array.from(included)) {
      if (existingBillsCents[i] >= target) {
        included.delete(i);
        excluded = true;
      }
    }
    if (!excluded) break;
  }

  const result = new Array(N).fill(0);
  if (included.size === 0) {
    // Every week is already at/above the mean — nothing to level. Fall back to
    // proportional-to-negative-slack (equal distribution among all N).
    const share = amountCents / N;
    const floors = new Array(N).fill(Math.floor(share));
    let leftover = amountCents - floors.reduce((a, b) => a + b, 0);
    for (let i = 0; i < N && leftover > 0; i++) {
      floors[i] += 1;
      leftover -= 1;
    }
    return floors;
  }

  let sum = 0;
  for (const i of included) sum += existingBillsCents[i];
  const target = (sum + amountCents) / included.size;

  // Ideal share per included week (fractional).
  const ideals: { i: number; ideal: number }[] = [];
  for (const i of included) {
    ideals.push({ i, ideal: target - existingBillsCents[i] });
  }
  let placed = 0;
  for (const x of ideals) {
    const floor = Math.floor(x.ideal);
    result[x.i] = Math.max(0, floor);
    placed += result[x.i];
  }
  let leftover = amountCents - placed;
  // Distribute remaining cents to the largest remainders.
  ideals.sort((a, b) => (b.ideal - Math.floor(b.ideal)) - (a.ideal - Math.floor(a.ideal)));
  for (const x of ideals) {
    if (leftover <= 0) break;
    result[x.i] += 1;
    leftover -= 1;
  }
  return result;
}

/**
 * Phase 1 (greedy whole-bill placement) + Phase 2 (iterative split refinement).
 *
 * Phase 1 sorts bills most-constrained-first (fewest eligible weeks) and
 * places each in the eligible week with the most remaining budget room — same
 * as the old best-fit-decreasing.
 *
 * Phase 2 walks the plan looking for pay weeks below target. In each pass it
 * takes the largest splittable bill in the most-shorted week, redistributes
 * its cents across ALL its eligible weeks using distributeBillLevel to level
 * the total per-week bills. Stops when no shortfall remains or a pass fails
 * to reduce the max shortfall.
 */
export function balancePayWeeks(inputs: BalanceInputs): BalanceResult {
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
      allocations: [],
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
    // Orphan fallback: mirrors getBillPeriodKey — bill fires before the first
    // payday AND next-month coord is past the forward-extension window.
    if (dueDate < firstStart && nextCoord > lastEnd) return nextCoord;
    return null;
  };

  // Weeks whose last day is on or before todayCoord are "past" — their
  // allocations are frozen in the database and the algorithm must not touch
  // them. This prevents a re-balance (triggered by any income/bill change)
  // from retroactively reassigning money that has already been received and
  // committed to a paycheck that landed in the past.
  const todayCoord = inputs.todayCoord ?? 0;
  const rawLocked = inputs.lockedAllocations ?? [];
  const lockedWeeks = new Set<number>();
  for (let i = 0; i < N; i++) {
    if (todayCoord > 0 && periods[i].endDay <= todayCoord) lockedWeeks.add(i);
  }

  const budget: number[] = periods.map(
    (_, i) =>
      (incomePerPeriodCents[i] ?? 0) -
      (fixedExpensesPerPeriodCents[i] ?? 0) -
      targetSurplusCents,
  );
  const perWeek: number[] = new Array(N).fill(0);

  // Pre-populate perWeek with locked allocations so surplus math is accurate.
  for (const la of rawLocked) {
    if (la.weekIndex >= 0 && la.weekIndex < N) {
      perWeek[la.weekIndex] += la.amountCents;
    }
  }
  // How many cents of each bill are already committed in locked weeks.
  const lockedCentsPerBill = new Map<string, number>();
  for (const la of rawLocked) {
    lockedCentsPerBill.set(la.billId, (lockedCentsPerBill.get(la.billId) ?? 0) + la.amountCents);
  }

  const unplaced: string[] = [];

  // Only weeks that haven't fully passed AND whose payday is on/before the
  // bill's occurrence coord are eligible for placement.
  const eligibleWeeks = (coord: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < N; i++) {
      if (!lockedWeeks.has(i) && periods[i].startDay <= coord) out.push(i);
    }
    return out;
  };

  // The period whose range actually contains the coord, skipping locked weeks.
  // Bills naturally belong here — Phase 1 places them here directly so they
  // never jump to an earlier week just because it has more budget room.
  const naturalWeekIdx = (coord: number): number => {
    for (let i = 0; i < N; i++) {
      if (!lockedWeeks.has(i) && coord >= periods[i].startDay && coord <= periods[i].endDay) return i;
    }
    // Natural period is locked — pick the last non-locked eligible period
    // (closest future week to the bill's due date).
    let last = -1;
    for (let i = 0; i < N; i++) {
      if (!lockedWeeks.has(i) && periods[i].startDay <= coord) last = i;
    }
    if (last >= 0) return last;
    // Last resort: last non-locked period.
    for (let i = N - 1; i >= 0; i--) {
      if (!lockedWeeks.has(i)) return i;
    }
    return N - 1;
  };

  interface WithMeta {
    bill: BillForBalance;
    coord: number;
    eligible: number[];
    naturalIdx: number;
    amountCents: number;
  }

  const withMeta: WithMeta[] = [];
  for (const b of bills) {
    const coord = occCoord(b.dueDate);
    if (coord == null) {
      unplaced.push(b.id);
      continue;
    }
    const lockedCents = lockedCentsPerBill.get(b.id) ?? 0;
    const remainingCents = Math.round(b.amount * 100) - lockedCents;
    const eligible = eligibleWeeks(coord);
    // Skip bills fully covered by locked weeks or with no eligible future weeks.
    if (remainingCents <= 0 || eligible.length === 0) continue;
    withMeta.push({
      bill: b,
      coord,
      eligible,
      naturalIdx: naturalWeekIdx(coord),
      amountCents: remainingCents,
    });
  }

  // Phase 1: place each bill in its natural period (the pay week whose date
  // range contains the bill's occurrence). This keeps Bread (Sep 1) in P4
  // instead of jumping it to P1 just because P1 has more budget room.
  const placement = new Map<string, Array<{ weekIndex: number; cents: number }>>();

  for (const w of withMeta) {
    placement.set(w.bill.id, [{ weekIndex: w.naturalIdx, cents: w.amountCents }]);
    perWeek[w.naturalIdx] += w.amountCents;
  }

  // Phase 2: iterative split refinement.
  const shortfallOf = (i: number) => Math.max(0, -( budget[i] - perWeek[i]));
  const maxShortfall = () => {
    let m = 0;
    for (let i = 0; i < N; i++) m = Math.max(m, shortfallOf(i));
    return m;
  };

  const splitAttempted = new Set<string>();
  let lastMax = maxShortfall();

  while (lastMax > 0) {
    // Find week with the largest shortfall.
    let worstWeek = -1;
    let worstShort = 0;
    for (let i = 0; i < N; i++) {
      const s = shortfallOf(i);
      if (s > worstShort) {
        worstShort = s;
        worstWeek = i;
      }
    }
    if (worstWeek < 0) break;

    // Find candidates in worstWeek that could be split.
    const meta = new Map(withMeta.map((w) => [w.bill.id, w]));
    const candidates = Array.from(placement.entries())
      .filter(([billId, allocs]) =>
        allocs.some((a) => a.weekIndex === worstWeek) &&
        !splitAttempted.has(billId),
      )
      .map(([billId, allocs]) => ({ billId, allocs, w: meta.get(billId)! }))
      .filter((x) =>
        x.w &&
        !x.w.bill.neverSplit &&
        x.w.eligible.length >= 2 &&
        x.w.amountCents >= MIN_SPLIT_CENTS,
      )
      // Prefer larger bills — bigger lever on the shortfall.
      .sort((a, b) => b.w.amountCents - a.w.amountCents);

    if (candidates.length === 0) break;

    const pick = candidates[0];
    splitAttempted.add(pick.billId);

    // Compute existing bills per eligible week EXCLUDING the pick.
    const existingForEligible = pick.w.eligible.map((i) => {
      let e = perWeek[i];
      for (const a of pick.allocs) {
        if (a.weekIndex === i) e -= a.cents;
      }
      return e;
    });

    // Also need to include the per-week budget in the leveling target. The
    // "level" isn't quite mean-of-existing; we want the SURPLUS to level, not
    // bills. Because surplus = budget_slot - existing_bills, leveling surplus
    // means placing bills proportional to how much room each week has above
    // the running low. Simpler equivalent: level (existing + allocation)
    // relative to per-week budget. We reduce to: level `existing - budget[i]`
    // so weeks with higher budget can absorb more.
    //
    // Concretely: treat "over-budget amount" (existing - budget) as the thing
    // to level. distributeBillLevel operates on that space.
    const budgetForEligible = pick.w.eligible.map((i) => budget[i]);
    const overForEligible = existingForEligible.map((e, k) => e - budgetForEligible[k]);
    const alloc = distributeBillLevel(pick.w.amountCents, overForEligible);

    // Apply new allocations: subtract old, add new.
    for (const a of pick.allocs) perWeek[a.weekIndex] -= a.cents;
    const newAllocs: Array<{ weekIndex: number; cents: number }> = [];
    for (let k = 0; k < pick.w.eligible.length; k++) {
      const w = pick.w.eligible[k];
      const cents = alloc[k];
      if (cents > 0) {
        newAllocs.push({ weekIndex: w, cents });
        perWeek[w] += cents;
      }
    }
    if (newAllocs.length === 0) {
      // Distribution collapsed to nothing (shouldn't happen when amount > 0);
      // revert.
      for (const a of pick.allocs) perWeek[a.weekIndex] += a.cents;
      break;
    }
    placement.set(pick.billId, newAllocs);

    const newMax = maxShortfall();
    if (newMax >= lastMax) {
      // No improvement — revert this split (keep the bill as it was) and stop.
      for (const a of newAllocs) perWeek[a.weekIndex] -= a.cents;
      for (const a of pick.allocs) perWeek[a.weekIndex] += a.cents;
      placement.set(pick.billId, pick.allocs);
      break;
    }
    lastMax = newMax;
  }

  const allocations: BalanceAllocation[] = [];
  for (const [billId, allocs] of placement.entries()) {
    for (const a of allocs) {
      allocations.push({ billId, weekIndex: a.weekIndex, amountCents: a.cents });
    }
  }

  return {
    allocations,
    perWeekBillCents: perWeek,
    feasible: maxShortfall() === 0,
    unplaced,
  };
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
