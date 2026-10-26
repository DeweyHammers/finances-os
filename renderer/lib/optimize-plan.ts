/**
 * optimize-plan — PHASE A of the Overview "Optimize" action, as a pure function.
 *
 * Moved verbatim out of `OverviewPage.handleOptimize` (Oct 2026) so the most
 * important planning code in the app can be unit-tested without rendering
 * React. Behavior is pinned by `OverviewPage.optimize.lockin.test.tsx`, which
 * was recorded against the in-component version before the move.
 *
 * Contract:
 *  - Plans every month in the horizon WITHOUT touching the DB. Returns the
 *    per-month write plans (rows to delete, rows to create) that PHASE B in
 *    the component applies. Months whose rows are already correct are left
 *    out (fast-path), so an up-to-date DB yields `[]`.
 *  - Throws (before anything is written) if the balance algorithm under-funds
 *    a bill occurrence or emits an allocation into a locked week.
 *  - Locked weeks (started on/before today) are history: their rows are fed
 *    to the algorithm as `lockedAllocations` and never deleted or re-created.
 *  - Pre-saving (Oct 2026): each month is balanced together with the NEXT
 *    month's first pay week, so bills firing there (nothing earlier in that
 *    view to level into) can be saved ahead from this month's unlocked
 *    weeks. Those slices are rows of THIS month with a coord past its last
 *    period; the next month then treats them as committed funding
 *    (`priorViewAllocations`) and plans only the remainder in its first week.
 *
 * See CLAUDE.md → "Overview optimizer — locked-week semantics",
 * "Locked weeks in balancePayWeeks" and "Optimize horizon".
 */
import {
  getPayPeriodsForMonth,
  balancePayWeeks,
  getBillOccurrencesInView,
  isPreSaveCoord,
  assertNoUnderfundedBills,
  isPayWeekLocked,
  monthKeyOf,
  computeIncomePerPeriodCents,
  PayPeriod,
} from "./pay-period-utils";

// How far forward the Optimize action plans. 36 months = 3 years, which
// keeps every month the user can realistically scroll to funded with proper
// BillSplit rows. Extending further inflates the first-run write cost
// without much planning value for a personal-finances tool.
// If you change it, also update the success toast in OverviewPage (it reads
// this constant) and CLAUDE.md → "Optimize horizon".
export const OPTIMIZE_HORIZON_MONTHS = 36;

/** One BillSplit row to create. */
export interface PlannedSplit {
  billId: string;
  weekIndex: number;
  amountCents: number;
  occurrenceCoord: number;
}

/** Pending DB writes for one month. `toDelete` holds the raw API rows (need `.id`). */
export interface MonthWritePlan {
  mk: string;
  toDelete: any[];
  toCreate: PlannedSplit[];
}

export interface OptimizeInputs {
  /** "Now" — decides which weeks are locked and where the horizon starts. */
  today: Date;
  /** Raw Bill rows from the API. */
  bills: any[];
  /** Raw Personal rows from the API. */
  personalBills: any[];
  /** Raw Income rows from the API. */
  incomes: any[];
  /** The isPrimary income — its payDay/cycle drive the pay-week grid. */
  primaryIncome: any;
  /** Raw BillSplit rows from the API (all months). */
  splitRows: any[];
  /** AppSettings.wifeWeeklyTargetCents (the "Surplus Target"). */
  targetSurplusCents: number;
  /** Defaults to OPTIMIZE_HORIZON_MONTHS. */
  horizonMonths?: number;
}

/**
 * Sums cents of "fixed personal expenses" landing in each pay period — the
 * OPTIMIZER's own rule, kept exactly as it was in OverviewPage.
 * Personal items come in three flavors:
 *   - repeatWeekly     → fires every pay period
 *   - weekOfMonth set  → fires only in that specific pay period (P1..P4)
 *   - dueDate set      → fires in the period covering its calendar day,
 *                        with forward-extension into the next month
 *                        (same rule getBillPeriodKey uses for bills).
 *
 * KNOWN DIFFERENCE (intentionally preserved, Oct 2026 audit): unlike Plan /
 * CashFlowOverview / PersonalOverview, this does NOT exclude
 * `splitAcrossWeeks` personals, and its dueDate check can count both the
 * in-month and next-month firing. No current data hits either case; the
 * user chose "no behavior changes" over aligning them.
 */
function computeOptimizerPersonalPerPeriod(personalBills: any[], periods: PayPeriod[]): number[] {
  return periods.map((p) => {
    let total = 0;
    personalBills.forEach((pb: any) => {
      let fires = false;
      if (pb.repeatWeekly) fires = true;
      else if (pb.weekOfMonth != null) fires = `P${pb.weekOfMonth}` === p.key;
      else {
        const D = Number(pb.dueDate);
        const nextCoord = D + p.daysInMonth;
        fires = (D >= p.startDay && D <= p.endDay) || (nextCoord >= p.startDay && nextCoord <= p.endDay);
      }
      if (fires) total += Math.round((Number(pb.amount) || 0) * 100);
    });
    return total;
  });
}

/**
 * PHASE A — plan every month in the horizon. Pure: no I/O, no React.
 * Iterates the next `horizonMonths` months. For each month:
 *   1. Builds the pay-period grid.
 *   2. Computes per-period income + fixed personal expenses.
 *   3. Preserves splits in already-started ("locked") pay weeks as history.
 *   4. Calls balancePayWeeks to allocate the remaining bill amounts.
 *   5. Verifies no bill occurrence was under-funded (fail loud).
 *   6. Diffs old vs new allocations and keeps only months that changed.
 */
export function planOptimize(inputs: OptimizeInputs): MonthWritePlan[] {
  const {
    today,
    bills,
    personalBills,
    incomes,
    primaryIncome,
    splitRows,
    targetSurplusCents,
    horizonMonths = OPTIMIZE_HORIZON_MONTHS,
  } = inputs;

  const payWeekday = Number(primaryIncome.payDay);
  const biWeekly = primaryIncome.paymentCycle === "BI_WEEKLY";

  // Income per pay period (shared helper in pay-period-utils — each income
  // may have its own payDay/cycle/offset for households with asymmetric
  // paychecks). Sources without their own cadence fall back to the PRIMARY
  // income's. No legacy AppSettings fallback here: the caller only runs
  // Optimize when a primary income exists, so `incomes` is never empty.
  const incomeDefaults = { payDay: payWeekday, paymentCycle: primaryIncome.paymentCycle };

  const writePlans: MonthWritePlan[] = [];

  // The BillSplit rows each month WILL have once this run is applied: the DB
  // rows to start with, replaced month by month as plans are made. Needed
  // because pre-saving (CLAUDE.md → "Pre-saving") links consecutive months:
  // month M reads the pre-save slices month M-1 just planned, which aren't in
  // `splitRows` yet. Months before the horizon keep their DB rows.
  const effectiveRows = new Map<string, any[]>();
  for (const r of splitRows) {
    const k = String(r.monthKey);
    if (!effectiveRows.has(k)) effectiveRows.set(k, []);
    effectiveRows.get(k)!.push(r);
  }

  // Main loop: horizonMonths forward from today. Apart from the pre-save
  // hand-off above, each iteration is independent — one month's
  // optimization never reads from another.
  for (let i = 0; i < horizonMonths; i++) {
    const target = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const tYear = target.getFullYear();
    const tMonth = target.getMonth();
    const mk = monthKeyOf(tYear, tMonth);

    const periods = getPayPeriodsForMonth(tYear, tMonth, payWeekday, today, biWeekly);
    if (periods.length === 0) continue;

    // Pre-save slices the PREVIOUS view holds for this month's first-week
    // occurrences: rows of the previous month whose coord lies past its last
    // period. They map to this view's in-month coord by subtracting the
    // previous month's length (the forward-extension convention).
    const prev = new Date(tYear, tMonth - 1, 1);
    const prevPeriods = getPayPeriodsForMonth(prev.getFullYear(), prev.getMonth(), payWeekday, today, biWeekly);
    const prevDays = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate();
    const priorViewAllocations = prevPeriods.length === 0
      ? []
      : (effectiveRows.get(monthKeyOf(prev.getFullYear(), prev.getMonth())) ?? [])
          .filter((r: any) => isPreSaveCoord(Number(r.occurrenceCoord ?? 0), prevPeriods))
          .map((r: any) => ({
            billId: String(r.billId),
            occurrenceCoord: Number(r.occurrenceCoord) - prevDays,
            amountCents: Number(r.amountCents),
          }));

    // The NEXT view's first pay week (income + fixed personal, same rules as
    // this month's own weeks) so this month's unlocked weeks can save ahead
    // for the bills firing in it.
    const next = new Date(tYear, tMonth + 1, 1);
    const nextPeriods = getPayPeriodsForMonth(next.getFullYear(), next.getMonth(), payWeekday, today, biWeekly);
    const nextViewFirstWeek = nextPeriods.length === 0
      ? undefined
      : {
          incomeCents: computeIncomePerPeriodCents(incomes, nextPeriods, next.getFullYear(), next.getMonth(), incomeDefaults)[0],
          fixedExpensesCents: computeOptimizerPersonalPerPeriod(personalBills, nextPeriods)[0],
        };

    // Only the current month has a today coord; future months treat
    // every period as unlocked (nothing has been "paid" yet).
    const isThisCurrentMonth = tYear === today.getFullYear() && tMonth === today.getMonth();
    const tTodayCoord = isThisCurrentMonth ? today.getDate() : 0;

    // A period is "locked" once it has STARTED — the paycheck for that
    // week has already been received and handed out, so we must not
    // rewrite its allocations. This includes the CURRENT week. Same
    // helper balancePayWeeks uses, so the two never disagree. See the
    // lockedAllocations block below for the full rationale.
    const lockedWeekIndices = new Set<number>(
      periods.filter((p) => isPayWeekLocked(p, tTodayCoord)).map((p) => p.index),
    );

    const existingForMonth = splitRows.filter((o: any) => String(o.monthKey) === mk);

    // Resolve legacy occurrenceCoord=0 rows to the bill's primary
    // (next-month-preferred) occurrence so the balance algorithm can
    // account for them per-occurrence.
    const resolveCoord = (billId: string, rawCoord: number): number => {
      if (rawCoord !== 0) return rawCoord;
      const bill = bills.find((b: any) => b.id === billId);
      if (!bill) return 0;
      const occs = getBillOccurrencesInView(Number(bill.dueDate ?? 0), periods);
      if (occs.length === 0) return 0;
      const primary = occs.find((o) => o.inNextMonth) ?? occs[0];
      return primary.coord;
    };

    // Every split in a locked week is HISTORY — it represents money the
    // paycheck for that week already committed. Preserve them as-is even
    // if they don't match the new algorithm's "natural" attribution, so
    // the algorithm accounts for what's already spent and only allocates
    // the REMAINING portion of each bill into future weeks. Deleting
    // these would cause the algorithm to re-place the full bill amount
    // into unlocked weeks, doubling up on already-committed funds.
    const lockedAllocations = existingForMonth
      .filter((o: any) => lockedWeekIndices.has(Number(o.weekIndex)))
      .map((o: any) => ({
        billId: String(o.billId),
        weekIndex: Number(o.weekIndex),
        amountCents: Number(o.amountCents),
        occurrenceCoord: resolveCoord(String(o.billId), Number(o.occurrenceCoord ?? 0)),
      }));

    const result = balancePayWeeks({
      bills: bills.map((b: any) => ({ id: b.id, amount: Number(b.amount), dueDate: Number(b.dueDate), neverSplit: Boolean(b.neverSplit) })),
      periods,
      incomePerPeriodCents: computeIncomePerPeriodCents(incomes, periods, tYear, tMonth, incomeDefaults),
      fixedExpensesPerPeriodCents: computeOptimizerPersonalPerPeriod(personalBills, periods),
      targetSurplusCents,
      todayCoord: tTodayCoord,
      lockedAllocations,
      priorViewAllocations,
      nextViewFirstWeek,
    });

    // Fail loud if the algorithm silently dropped funding for any bill
    // occurrence — this is the guard that prevents "a bill missing
    // from Sep P1" bugs from ever reappearing without a scream.
    assertNoUnderfundedBills(result, `Optimize Now — ${mk}`);

    // Only unlocked rows are recomputed; locked-week rows are preserved
    // as-is (they represent past-paycheck commitments).
    const toDelete = existingForMonth.filter(
      (o: any) => !lockedWeekIndices.has(Number(o.weekIndex)),
    );

    // Invariant: the algorithm never places cents in a locked week (it
    // reports those occurrences in `skipped` instead). A locked-week
    // insert can collide with the committed row for the same key — the
    // Oct 2026 unique-constraint 500 — so fail loud in PHASE A, before
    // anything is written, if that ever regresses.
    const lockedAlloc = result.allocations.find((a) => lockedWeekIndices.has(a.weekIndex));
    if (lockedAlloc) {
      throw new Error(
        `balancePayWeeks placed ${lockedAlloc.billId}@${lockedAlloc.occurrenceCoord} into locked week P${lockedAlloc.weekIndex + 1} (${mk})`,
      );
    }

    // Skipped occurrences with NO rows yet get a $0 marker in their
    // (locked) home week. Without it, display code finds no split for the
    // occurrence and falls back to natural attribution — showing the full
    // amount in the current week, which is exactly what we're skipping.
    // The marker is a locked row on the next run (hasLockedRows=true), so
    // it's written once and then left alone.
    const markers: PlannedSplit[] = result.skipped
      .filter((s) => !s.hasLockedRows)
      .map((s) => ({ billId: s.billId, weekIndex: s.weekIndex, amountCents: 0, occurrenceCoord: s.occurrenceCoord }));

    // What this month's rows look like once this plan is applied — the next
    // iteration reads its pre-save slices from here. Locked rows survive;
    // unlocked ones are replaced by the fresh allocations (+ markers).
    effectiveRows.set(mk, [
      ...existingForMonth.filter((o: any) => lockedWeekIndices.has(Number(o.weekIndex))),
      ...[...result.allocations, ...markers].map((a) => ({ ...a, monthKey: mk })),
    ]);

    // Fast-path early exit: if the new allocation set is identical to
    // what's already in the DB for this month, skip the delete+create
    // round-trip entirely. Saves dozens of Prisma writes on months
    // that didn't need any change.
    const currentSig = toDelete
      .map((o: any) => `${o.billId}:${o.weekIndex}:${o.occurrenceCoord ?? 0}:${o.amountCents}`)
      .sort()
      .join(",");
    const newSig = result.allocations
      .map((a) => `${a.billId}:${a.weekIndex}:${a.occurrenceCoord}:${a.amountCents}`)
      .sort()
      .join(",");
    if (currentSig === newSig && markers.length === 0) continue;

    writePlans.push({ mk, toDelete, toCreate: [...result.allocations, ...markers] });
  }

  return writePlans;
}
