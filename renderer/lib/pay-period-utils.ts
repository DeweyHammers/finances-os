/**
 * pay-period-utils — Pay-period model + bill placement / auto-balance algorithm.
 *
 * This is the largest and highest-stakes utility in the app. It encodes how
 * a month's paychecks are sliced into "pay weeks" (P1..PN), how monthly
 * recurring bills are attributed to those weeks, and how the auto-balance
 * optimizer levels bill totals across weeks while preserving locked
 * (already-past) allocations.
 *
 * KEY CONCEPTS
 *
 * 1. FORWARD EXTENSION (no backward extension). A pay period BELONGS to the
 *    month of its payday. If a month's last paycheck lands on the 29th and
 *    the next payday is Aug 5, the July view's final period runs Jul 29 →
 *    Aug 4. Bills firing on Aug 1-4 are funded from the Jul 29 paycheck and
 *    surface in July's view. There is NO backward extension — an Aug 6 bill
 *    funded by the Aug 5 paycheck is in August's view, not July's.
 *
 * 2. "COORD" SPACE. Every day in the view has a coord = day-of-current-month
 *    (1..31), extended past daysInMonth to represent forward-extension days
 *    (e.g. Aug 3 seen from July = coord 34 when July has 31 days). Occurrence
 *    matching + eligibility checks all work in coord space.
 *
 * 3. MULTI-OCCURRENCE BILLS. A view can contain up to TWO occurrences of the
 *    same monthly bill: the in-month firing AND the next-month forward-
 *    extended firing (when 5 paydays land in the month). `getBillOccurrencesInView`
 *    enumerates both. `BillSplit.occurrenceCoord` distinguishes which one a
 *    persisted split funds. `balancePayWeeks` places each as an independent
 *    unit so a bill never silently disappears.
 *
 * 4. ORPHAN-FALLBACK SKIP. When a bill fires BEFORE this view's first payday
 *    AND its next-month occurrence is past the forward-extension window, we
 *    attribute it to the last period as a fallback (never drop the bill).
 *    EXCEPT: when the NEXT view's first payday is ≤ the bill's dueDate, the
 *    next view naturally covers the firing and orphaning here would double-
 *    count. See `nextViewFirstPayday` on PayPeriod.
 *
 * 5. LOCKED WEEKS. A pay week locks as soon as it STARTS (its paycheck has
 *    landed and been handed out — see `isPayWeekLocked`), so the current
 *    week is locked too. Locked weeks keep their existing BillSplit rows
 *    verbatim (`lockedAllocations`), and the algorithm NEVER places new cents
 *    into them: a paycheck that already came and went can't fund anything
 *    new. An occurrence (or uncommitted remainder) whose eligible weeks are
 *    ALL locked — a bill moved/added into the current week, a price bump on
 *    a bill due this week, a past firing with no row — is returned in
 *    `skipped` instead: not planned this cycle, not underfunded. When the
 *    occurrence has no rows at all, the caller writes a $0 marker row in its
 *    home week so display code doesn't fall back to showing the full amount
 *    there (see OverviewPage.handleOptimize, BillsOverview "Skipped" card).
 *
 * 6. PRE-SAVING (Oct 2026). A bill that fires in the NEXT view's FIRST pay
 *    week (due on/after `nextViewFirstPayday`, no later than
 *    `nextViewFirstWeekEndDay`) has no earlier week in that view to level
 *    into — when the first payday is the 4th, bills due the 4th–6th all pile
 *    onto that one paycheck. So this view's UNLOCKED weeks may save ahead for
 *    it: `balancePayWeeks` gets the next view's first week as a virtual extra
 *    week (`nextViewFirstWeek`) and levels those occurrences across this
 *    view's unlocked weeks and that week. The slices saved here are ordinary
 *    BillSplit rows of THIS month tagged `occurrenceCoord = day + daysInMonth`
 *    (the forward-extension convention), which puts them PAST the view's
 *    last period end — `isPreSaveCoord`. The firing itself still belongs to
 *    exactly one view (the next one), so `getBillOccurrencesInView` never
 *    returns it here; only persisted rows surface it (there is no natural
 *    fallback for a pre-save). When the next view is balanced, those prior-
 *    view rows count as committed funding (`priorViewAllocations`) and only
 *    the remainder lands in its first week.
 *
 * See CLAUDE.md → "Multi-occurrence bills", "Orphan-fallback skip",
 * "DueDate > daysInMonth clamping", "Pre-saving" for more.
 */

/** Per-period accent color — indexed by 0-based pay-week position. */
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
  /** Day-of-next-month for the NEXT view's first payday, or null if none.
   * Used by the orphan-fallback check: a bill whose dueDate ≥ this value has
   * its next-month occurrence handled naturally by the next view, so it must
   * NOT be orphan-attributed to this view (that would double-count the
   * payment across two views). */
  nextViewFirstPayday: number | null;
  /** Day-of-next-month on which the NEXT view's FIRST pay week ends (the day
   * before its second payday, or its last day when it has one payday). A
   * bill due in [nextViewFirstPayday, nextViewFirstWeekEndDay] lands in that
   * first week with nothing earlier to level into, so this view may pre-save
   * for it — see header note 6 and `getPreSaveOccurrence`. */
  nextViewFirstWeekEndDay: number | null;
  /** Length of the following calendar month — lets a pre-save clamp a bill's
   * dueDate the way the next view clamps its own in-month coord. */
  daysInNextMonth: number;
}

/**
 * A pay week is "locked" once it has STARTED — its payday is on or before
 * today. That paycheck has already been received and handed out, so the
 * optimizer treats the week's BillSplit rows as committed history and never
 * levels money into it. `todayCoord` is today's day-of-month in this view
 * (0 for future months, where nothing is locked).
 *
 * This used to be `endDay <= todayCoord` (week fully ENDED), which left the
 * in-progress week re-plannable: hitting Optimize mid-week rewrote the current
 * week's bills and changed a surplus that had already been spent.
 *
 * Shared by `balancePayWeeks` and the Overview optimizer so the two can never
 * disagree about which weeks are frozen.
 */
export function isPayWeekLocked(period: Pick<PayPeriod, "startDay">, todayCoord: number): boolean {
  return todayCoord > 0 && period.startDay <= todayCoord;
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

  // Enumerate the payday days-of-month for a given (year, month). For
  // BI_WEEKLY, keep every other weekly payday starting from the first (so
  // 5-payday months collapse to 3 BI_WEEKLY payments, 4-payday to 2, etc).
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
  // End of the next view's first pay week: the day before its second payday.
  // With a single payday the whole month is that week (clamped to the month;
  // any forward extension past it can't hold an in-month due date anyway).
  const daysInNextMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
  const nextFirstWeekEndDay =
    nextFirstPayday == null
      ? null
      : nextMonthPayDays.length > 1
        ? nextMonthPayDays[1] - 1
        : daysInNextMonth;

  // Each period starts on its payday and ends the day BEFORE the next payday.
  // The final period gets special treatment: it extends past daysInMonth to
  // capture bills funded by this month's last paycheck that land in the
  // opening days of next month.
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

    // Human label for the period: "Aug 12 – Aug 18", or "Aug 29 – Sep 4"
    // when the period forward-extends into next month.
    const startLabel = `${monthAbbr} ${startDay}`;
    const endLabel =
      endDay > daysInMonth
        ? `${nextMonthAbbr} ${endDay - daysInMonth}`
        : `${monthAbbr} ${endDay}`;
    const dateRange =
      startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;

    // "isCurrent" highlights today's pay week in the Overview. Two cases:
    //  (a) today is in this view's month AND its day is in the period, or
    //  (b) today is in next month AND within the forward-extension slice.
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
      nextViewFirstPayday: nextFirstPayday,
      nextViewFirstWeekEndDay: nextFirstWeekEndDay,
      daysInNextMonth,
    };
  });
}

/**
 * Clamps a day-of-month to the given month's actual length. Used when a bill
 * with dueDate=31 needs to be rendered in a 30-day month — clamp to 30
 * rather than leak into next-month coord space (which would falsely display
 * as "Sept 1st"). See CLAUDE.md → "DueDate > daysInMonth clamping".
 */
export function clampDayToMonth(day: number, year: number, month: number): number {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return Math.min(day, daysInMonth);
}

/**
 * Returns EVERY monthly-bill occurrence that fires within a view. A view can
 * contain up to two occurrences of the same bill because it spans from the
 * first payday of month M through the day before month M+1's first payday:
 *
 *  - IN-MONTH occurrence at coord = dueDate (when dueDate falls in the view)
 *  - NEXT-MONTH occurrence at coord = dueDate + daysInMonth (forward extension)
 *
 * If dueDate < firstStart AND nextMonthCoord > lastEnd, the bill would be
 * orphaned — no paycheck in the view lands before the due date. The orphan is
 * attributed to the LAST period (that's the paycheck closest to the bill) so
 * it never disappears from the view.
 *
 * Multi-occurrence months are common: any 5-payday month whose forward
 * extension reaches into next-month days that also exist as in-month due
 * dates. Missing this case causes bills to silently disappear from the
 * schedule, which is the whole reason this helper exists.
 */
export interface BillOccurrenceInfo {
  /** Day-of-current-month coordinate (in-month = D, next-month = D+daysInMonth,
   * orphan = D+daysInMonth even though it exceeds lastEnd). Unique per occurrence. */
  coord: number;
  /** 0-based index of the pay period this occurrence lands in. */
  weekIndex: number;
  /** Pay-period key ("P1", "P2", ...) for the landing period. */
  periodKey: string;
  /** True when the coord is past daysInMonth (occurs in the following month). */
  inNextMonth: boolean;
  /** True when this occurrence was attributed via the orphan fallback rather
   * than a natural landing. Callers may want to warn on this. */
  isOrphan: boolean;
}

export function getBillOccurrencesInView(
  dueDate: number,
  periods: PayPeriod[],
): BillOccurrenceInfo[] {
  if (periods.length === 0) return [];
  const daysInMonth = periods[0].daysInMonth;
  const firstStart = periods[0].startDay;
  const lastEnd = periods[periods.length - 1].endDay;
  // Coordinate the next-month firing would land at inside THIS view (day-of
  // current-month + daysInMonth). E.g. Aug view with Sept 4 firing → coord 35.
  const nextMonthCoord = dueDate + daysInMonth;
  const nextViewFirstPayday = periods[0].nextViewFirstPayday;

  const raw: Array<{ coord: number; isOrphan: boolean }> = [];
  // In-month: clamp dueDate to daysInMonth so a "31st" bill in a 30-day
  // month lands at coord=30 (last day of month) rather than being pushed
  // into the next-month coord range where it would display as "the 1st"
  // and confusingly overlap with next view's in-month attribution.
  const inMonthCoord = Math.min(dueDate, daysInMonth);
  if (inMonthCoord >= firstStart && inMonthCoord <= lastEnd) {
    raw.push({ coord: inMonthCoord, isOrphan: false });
  }
  // Next-month coord uses the raw dueDate + daysInMonth so we don't
  // accidentally overlap the in-month clamp above (e.g., dueDate=31 in a
  // 30-day month: in-month coord=30, next-month coord=61 — never collide).
  if (
    nextMonthCoord !== inMonthCoord &&
    nextMonthCoord >= firstStart &&
    nextMonthCoord <= lastEnd
  ) {
    raw.push({ coord: nextMonthCoord, isOrphan: false });
  }
  if (raw.length === 0 && dueDate < firstStart && nextMonthCoord > lastEnd) {
    // Orphan candidate: bill fires before this month's first payday AND its
    // next-month occurrence is past the forward-extension window. Only
    // attribute it here if the NEXT view can't naturally cover the next-month
    // firing (i.e., that view's first payday lands AFTER the due date, so
    // the bill would be orphaned there too). Otherwise the next view's
    // in-month case will handle it and orphaning here would double-count.
    const nextViewCovers =
      nextViewFirstPayday != null && dueDate >= nextViewFirstPayday;
    if (!nextViewCovers) {
      raw.push({ coord: nextMonthCoord, isOrphan: true });
    }
  }

  // Locates the pay week whose range contains the coord. Orphans always
  // fall into the LAST period — the paycheck closest to the (now-past) due
  // date is the best proxy for where a user would have covered it from.
  const findWeekIdx = (coord: number, isOrphan: boolean): number => {
    if (isOrphan) return periods.length - 1;
    for (let i = 0; i < periods.length; i++) {
      if (coord >= periods[i].startDay && coord <= periods[i].endDay) return i;
    }
    return periods.length - 1;
  };

  return raw.map(({ coord, isOrphan }) => {
    const weekIndex = findWeekIdx(coord, isOrphan);
    return {
      coord,
      weekIndex,
      periodKey: periods[weekIndex].key,
      inNextMonth: coord > daysInMonth,
      isOrphan,
    };
  });
}

// ── Pre-save occurrences (header note 6) ──

export interface PreSaveOccurrenceInfo {
  /** Coord in THIS view's space: day + daysInMonth. Always > the last
   * period's endDay, which is how persisted rows are recognised as pre-save
   * slices (`isPreSaveCoord`). Equals the next view's in-month coord plus
   * this month's length, so `coord - daysInMonth` recovers that occurrence. */
  coord: number;
  /** Calendar day of the firing in the next month (dueDate clamped to it). */
  day: number;
}

/**
 * The next view's FIRST-pay-week occurrence of a monthly bill, expressed in
 * this view's coord space — or null when the bill doesn't fire in that week.
 * That occurrence has no earlier week in its own view to level into, so this
 * view's unlocked weeks are allowed to save ahead for it. It is deliberately
 * NOT part of `getBillOccurrencesInView`: for counting, display fallback and
 * grace windows the firing belongs to the next view alone.
 */
export function getPreSaveOccurrence(
  dueDate: number,
  periods: PayPeriod[],
): PreSaveOccurrenceInfo | null {
  if (periods.length === 0) return null;
  const { daysInMonth, daysInNextMonth, nextViewFirstPayday, nextViewFirstWeekEndDay } = periods[0];
  if (nextViewFirstPayday == null || nextViewFirstWeekEndDay == null) return null;
  // Same clamp the next view applies to its in-month coord (a bill due the
  // 31st fires on the 30th of a 30-day month), so the two coords agree.
  const day = Math.min(dueDate, daysInNextMonth);
  if (day < nextViewFirstPayday || day > nextViewFirstWeekEndDay) return null;
  return { coord: day + daysInMonth, day };
}

/** True when a persisted row's coord lies past the view's last period — i.e.
 * it is a pre-save slice for the next view's first pay week. */
export function isPreSaveCoord(coord: number, periods: PayPeriod[]): boolean {
  if (periods.length === 0) return false;
  return coord > periods[periods.length - 1].endDay;
}

/**
 * Returns the PRIMARY period key for a monthly-recurring bill, using the old
 * "next-month occurrence wins" precedence rule. Kept for callers (like Personal
 * bills, which don't currently support per-occurrence placement) that only need
 * one attribution point. For bills, prefer `getBillOccurrencesInView` — it
 * enumerates every occurrence and prevents silent double-coverage misses.
 */
export function getBillPeriodKey(
  dueDate: number,
  periods: PayPeriod[],
): string | null {
  const occs = getBillOccurrencesInView(dueDate, periods);
  if (occs.length === 0) return null;
  // Prefer next-month occurrence (matches original algorithm's precedence
  // so callers that persisted state under this rule stay consistent).
  const nextMonth = occs.find((o) => o.inNextMonth);
  return (nextMonth ?? occs[0]).periodKey;
}

// ── BillSplit schema + allocation helpers ──

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
  /** Coord of the specific occurrence this row funds. Legacy rows may omit
   * (or store 0) — those are matched to the primary (next-month-preferred)
   * occurrence for backward compatibility. */
  occurrenceCoord?: number;
}

export interface BillAllocation {
  weekIndex: number;
  periodKey: string;
  amountCents: number;
  /** True when this occurrence is spread across ≥ 2 weeks (i.e., THIS occurrence
   * has multiple rows). A bill with two separate occurrences that are each
   * single-week is NOT considered "split". */
  isSplit: boolean;
  /** Occurrence this allocation belongs to. */
  occurrenceCoord: number;
  /** True for a pre-save slice: this row funds the NEXT view's first-week
   * occurrence (its coord lies past this view's last period — header note
   * 6). Rendered as "Split · <next month> <day>" in the prior month. */
  isPreSave: boolean;
  /** Cents the PREVIOUS view already saved for this occurrence (its pre-save
   * rows). Carried on the occurrence's FIRST row only, so summing rows'
   * `amountCents + priorViewSavedCents` never double-counts it. 0 elsewhere. */
  priorViewSavedCents: number;
}

/** "YYYY-MM" → the previous month's key and that month's length. */
function previousMonthOf(monthKey: string): { key: string; daysInMonth: number } {
  const [y, m1] = monthKey.split("-").map(Number); // m1 is 1-based
  const prev = new Date(y, m1 - 2, 1); // 0-based month (m1 - 1), minus one
  return {
    key: monthKeyOf(prev.getFullYear(), prev.getMonth()),
    daysInMonth: new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate(),
  };
}

/**
 * Cents the PREVIOUS view's BillSplit rows pre-saved for this view's
 * in-month occurrence at `coord` (header note 6). Those rows are tagged with
 * `coord + daysInPreviousMonth`, the forward-extension convention, which
 * cannot collide with a genuine forward-extension row of that view (those
 * end the day before this view's first payday, and only first-pay-week
 * occurrences are ever pre-saved).
 */
export function getPriorViewSavedCents(
  billId: string,
  coord: number,
  monthKey: string,
  splits: BillSplitRecord[],
): number {
  const prev = previousMonthOf(monthKey);
  const target = coord + prev.daysInMonth;
  return splits
    .filter(
      (s) =>
        s.billId === billId &&
        s.monthKey === prev.key &&
        (s.occurrenceCoord ?? 0) === target,
    )
    .reduce((sum, s) => sum + s.amountCents, 0);
}

/**
 * Returns every pay-week allocation for a given bill within the view — one
 * or more rows per occurrence. When BillSplit rows exist for an occurrence
 * they win; otherwise falls back to natural attribution (full bill amount in
 * the occurrence's home period) so the bill never silently disappears.
 *
 * Legacy split rows (occurrenceCoord=0 or undefined) are matched to the
 * primary occurrence (next-month-preferred) so pre-fix data continues to
 * render correctly until the next Optimize Now run rewrites them.
 */
export function getBillAllocationsForBill(
  billId: string,
  dueDate: number,
  amountDollars: number,
  periods: PayPeriod[],
  monthKey: string,
  splits: BillSplitRecord[],
): BillAllocation[] {
  if (periods.length === 0) return [];
  const occurrences = getBillOccurrencesInView(dueDate, periods);

  const forBill = splits.filter(
    (s) =>
      s.billId === billId &&
      s.monthKey === monthKey &&
      s.weekIndex >= 0 &&
      s.weekIndex < periods.length,
  );

  // Primary occurrence = the "next-month-preferred" one (matches the old
  // getBillPeriodKey precedence). Legacy split rows written before
  // occurrenceCoord existed are pinned to this occurrence for back-compat.
  const primaryOcc = occurrences.find((o) => o.inNextMonth) ?? occurrences[0];
  const amountCents = Math.round(amountDollars * 100);
  const result: BillAllocation[] = [];

  for (const occ of occurrences) {
    let occSplits = forBill.filter(
      (s) => (s.occurrenceCoord ?? 0) === occ.coord,
    );
    // Backward compat: legacy rows written without occurrenceCoord (stored 0)
    // belong to the primary occurrence.
    if (occSplits.length === 0 && occ.coord === primaryOcc.coord) {
      occSplits = forBill.filter((s) => (s.occurrenceCoord ?? 0) === 0);
    }

    // Header note 6: an in-month occurrence in the FIRST pay week may have
    // been pre-saved by the previous view. Those cents are part of this
    // occurrence's funding (they sit in the same Plan envelope), so they
    // make it a split, feed cumulative "Saved" totals and shrink the
    // natural fallback to the remainder — never a second full amount.
    // Capped at what this occurrence's own rows leave uncovered: a real
    // pre-save plus its remainder equals the bill exactly, so the cap is a
    // no-op for it, but it neutralises leftover rows from the pre-Aug-2026
    // orphan era (a Sep 4 firing attributed to BOTH the Aug view and Sep P1)
    // that carry the same coord signature in a locked past month.
    const ownRowCents = occSplits.reduce((s, r) => s + r.amountCents, 0);
    const priorViewSavedCents =
      occ.weekIndex === 0 && !occ.inNextMonth && !occ.isOrphan
        ? Math.min(
            getPriorViewSavedCents(billId, occ.coord, monthKey, splits),
            Math.max(0, amountCents - ownRowCents),
          )
        : 0;

    if (occSplits.length > 0) {
      // Split rows exist for this occurrence — honor them verbatim.
      // isSplit is per-occurrence: a bill with two occurrences that each
      // sit in a single week is NOT considered "split".
      const sorted = [...occSplits].sort((a, b) => a.weekIndex - b.weekIndex);
      const isSplit = sorted.length > 1 || priorViewSavedCents > 0;
      sorted.forEach((s, i) => {
        result.push({
          weekIndex: s.weekIndex,
          periodKey: periods[s.weekIndex].key,
          amountCents: s.amountCents,
          isSplit,
          occurrenceCoord: occ.coord,
          isPreSave: false,
          priorViewSavedCents: i === 0 ? priorViewSavedCents : 0,
        });
      });
    } else {
      // No splits → natural attribution: full bill amount (less whatever the
      // previous view pre-saved) lands in the occurrence's home period.
      // Ensures a bill never silently disappears just because BillSplit
      // hasn't been populated yet.
      result.push({
        weekIndex: occ.weekIndex,
        periodKey: occ.periodKey,
        amountCents: Math.max(0, amountCents - priorViewSavedCents),
        isSplit: priorViewSavedCents > 0,
        occurrenceCoord: occ.coord,
        isPreSave: false,
        priorViewSavedCents,
      });
    }
  }

  // Pre-save slices for the NEXT view's first pay week (header note 6):
  // rows of THIS month whose coord lies past the last period. They are only
  // ever persisted (no natural fallback — the firing is counted by the next
  // view), and always "split" because the remainder lives over there.
  const preSaveRows = forBill.filter((s) => isPreSaveCoord(s.occurrenceCoord ?? 0, periods));
  const preSaveCoords = Array.from(new Set(preSaveRows.map((s) => s.occurrenceCoord ?? 0))).sort((a, b) => a - b);
  for (const coord of preSaveCoords) {
    const rows = preSaveRows
      .filter((s) => (s.occurrenceCoord ?? 0) === coord)
      .sort((a, b) => a.weekIndex - b.weekIndex);
    for (const s of rows) {
      result.push({
        weekIndex: s.weekIndex,
        periodKey: periods[s.weekIndex].key,
        amountCents: s.amountCents,
        isSplit: true,
        occurrenceCoord: coord,
        isPreSave: true,
        priorViewSavedCents: 0,
      });
    }
  }

  return result;
}

/**
 * Returns the natural home week index for the primary (next-month-preferred)
 * occurrence of a monthly bill, or null when the bill has no occurrence in
 * the view. Prefer `getBillOccurrencesInView` when you need to enumerate
 * every occurrence — this helper is kept for single-occurrence callsites.
 */
export function getBillNaturalWeekIndex(
  dueDate: number,
  periods: PayPeriod[],
): number | null {
  const occs = getBillOccurrencesInView(dueDate, periods);
  if (occs.length === 0) return null;
  return (occs.find((o) => o.inNextMonth) ?? occs[0]).weekIndex;
}

/**
 * Returns true when a persisted split at (billId, weekIndex, occurrenceCoord)
 * corresponds to that bill's natural single-week attribution (i.e. the row
 * matches what the balance algorithm would produce if it treated this
 * occurrence as un-split). Used by the Overview optimizer to distinguish
 * user-locked "natural" rows in past pay weeks from algorithm-generated
 * splits that should be regenerated.
 */
export function isNaturalOccurrenceRow(
  dueDate: number,
  periods: PayPeriod[],
  weekIndex: number,
  occurrenceCoord: number,
): boolean {
  const occs = getBillOccurrencesInView(dueDate, periods);
  const match = occs.find((o) => o.coord === occurrenceCoord);
  if (!match) return false;
  return match.weekIndex === weekIndex;
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

// ── Auto-balance algorithm (balancePayWeeks) ──

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
   * for future months where no locking applies). Any period that has STARTED
   * by this day is locked (see `isPayWeekLocked`) — its allocations are frozen
   * and leveling never spreads new cents into it. */
  todayCoord?: number;
  /** Existing BillSplit rows for locked periods. These are pre-credited into
   * perWeek as fixed costs and reduce each bill's remaining amount. The
   * algorithm never outputs allocations for locked weeks; occurrences that
   * only fit there land in `skipped` (header note 5). */
  lockedAllocations?: BalanceAllocation[];
  /** Header note 6: pre-save slices the PREVIOUS view's weeks already put
   * aside for this view's first-pay-week occurrences, keyed by THIS view's
   * coord (= the row's coord minus the previous month's length). Committed
   * funding for the occurrence (reduces its remainder, counts toward
   * `underfunded`) but it lives in another month's weeks, so it never enters
   * perWeek and never counts as a row of this month. */
  priorViewAllocations?: PriorViewAllocation[];
  /** Header note 6: the NEXT view's first pay week, so this view's unlocked
   * weeks can pre-save for the bills firing in it. Joins the grid as one
   * virtual extra week (index `periods.length`) that only those occurrences
   * may use. Omit to disable pre-saving (e.g. no next view). */
  nextViewFirstWeek?: NextViewFirstWeek;
}

export interface PriorViewAllocation {
  billId: string;
  /** This view's in-month coord of the occurrence (= its dueDate, clamped). */
  occurrenceCoord: number;
  amountCents: number;
}

export interface NextViewFirstWeek {
  /** Income landing in the next view's first pay week, in cents. */
  incomeCents: number;
  /** Fixed (personal) expenses of that week, in cents — the optimizer's own
   * rule, see `computeOptimizerPersonalPerPeriod` in optimize-plan.ts. */
  fixedExpensesCents: number;
}

export interface BalanceAllocation {
  billId: string;
  weekIndex: number;
  amountCents: number;
  /** Which occurrence of the bill this allocation funds (coord in view space). */
  occurrenceCoord: number;
}

export interface BalanceResult {
  /** One row per (bill, occurrence, week) with the cents that pay-week gets.
   * Un-split occurrences produce exactly one row with amountCents = bill total.
   * Split occurrences produce ≥ 2 rows summing to the bill total. */
  allocations: BalanceAllocation[];
  /** Total bill cents finally landed in each period (sum of allocations). */
  perWeekBillCents: number[];
  /** True when every pay week's surplus meets or exceeds the target. */
  feasible: boolean;
  /** Bills whose occurrence falls outside this month's coverage window and
   * therefore weren't placed at all. Callers can surface these. */
  unplaced: string[];
  /** Occurrences whose allocations + locked cents don't sum to the bill's full
   * amount (i.e., the algorithm couldn't fully fund them). Format: "billId@coord".
   * Must be empty for a healthy plan — pass to `assertNoUnderfundedBills` at any
   * callsite that wants to fail loud when funding is silently missed. */
  underfunded: string[];
  /** Occurrences (or the uncommitted remainder of one) that can ONLY be funded
   * from a locked week — e.g. a bill moved/added into the current week, or a
   * bill due this week whose price went up after payday. That paycheck is
   * already handed out, so the cents are NOT planned this cycle (the user
   * covered them outside the plan, e.g. from savings). Exempt from
   * `underfunded`. See header note 5. */
  skipped: SkippedOccurrence[];
  /** Bill cents the plan leaves in the NEXT view's first pay week (the
   * remainders of its pre-save occurrences after this view saved ahead).
   * 0 when `nextViewFirstWeek` wasn't supplied. Informational — that week's
   * rows are written by the next view's own balance. */
  nextViewFirstWeekBillCents: number;
}

export interface SkippedOccurrence {
  billId: string;
  occurrenceCoord: number;
  /** The locked week the occurrence would naturally have landed in. */
  weekIndex: number;
  /** Cents not planned this cycle. */
  skippedCents: number;
  /** True when the occurrence already has ≥1 BillSplit row in a locked week
   * (only the remainder is skipped — existing rows already describe what the
   * paycheck covered). False → no rows at all: the caller must write a $0
   * marker row in `weekIndex`, otherwise display code falls back to natural
   * attribution and shows the full amount in that week anyway. */
  hasLockedRows: boolean;
}

/**
 * Throws with a descriptive message when a BalanceResult has any underfunded
 * occurrences. Call this at the boundary of any code path that must not
 * silently drop bill funding (e.g., the Optimize Now flow persisting splits).
 */
export function assertNoUnderfundedBills(
  result: BalanceResult,
  context?: string,
): void {
  if (result.underfunded.length === 0) return;
  const where = context ? ` (${context})` : "";
  throw new Error(
    `balancePayWeeks left ${result.underfunded.length} bill occurrence(s) underfunded${where}: ${result.underfunded.join(", ")}`,
  );
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

  // Start with every week included; iteratively drop weeks whose existing
  // bills already exceed the mean (they can't absorb any more without
  // making things WORSE).
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
  // Distribute remaining cents to the largest remainders (Hamilton /
  // largest-remainder method — guarantees the outputs sum to amountCents
  // exactly while minimizing per-week rounding drift).
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
      underfunded: [],
      skipped: [],
      nextViewFirstWeekBillCents: 0,
    };
  }

  // Weeks that have already STARTED (payday on/before todayCoord) are locked —
  // their allocations are frozen in the database and the algorithm must not
  // touch them. This prevents a re-balance (triggered by any income/bill
  // change) from retroactively reassigning money that has already been
  // received and committed to a paycheck, including the current week's.
  const todayCoord = inputs.todayCoord ?? 0;
  const rawLocked = inputs.lockedAllocations ?? [];
  const lockedWeeks = new Set<number>();
  for (let i = 0; i < N; i++) {
    if (isPayWeekLocked(periods[i], todayCoord)) lockedWeeks.add(i);
  }

  // Header note 6: the NEXT view's first pay week joins the grid as ONE
  // virtual extra week (index V = N) when the caller supplies its income and
  // fixed expenses and a next view exists. Only pre-save occurrences (bills
  // firing in that week) may use it — it is their natural home — and this
  // view's own bills never move into it. It is never locked: had it started,
  // every week here would have started too and nothing could be leveled.
  const nextWeek = inputs.nextViewFirstWeek;
  const hasVirtual = nextWeek != null && periods[0].nextViewFirstPayday != null;
  const V = N;
  const W = hasVirtual ? N + 1 : N; // slots in budget / perWeek

  // "budget" per period = the cents available for bills after subtracting
  // fixed personal expenses and the surplus-target we want to preserve.
  // This is what perWeek needs to stay under (or shortfall exists).
  const budget: number[] = periods.map(
    (_, i) =>
      (incomePerPeriodCents[i] ?? 0) -
      (fixedExpensesPerPeriodCents[i] ?? 0) -
      targetSurplusCents,
  );
  if (hasVirtual) {
    budget.push(nextWeek!.incomeCents - nextWeek!.fixedExpensesCents - targetSurplusCents);
  }
  const perWeek: number[] = new Array(W).fill(0);

  // Pre-populate perWeek with locked allocations so surplus math is accurate.
  for (const la of rawLocked) {
    if (la.weekIndex >= 0 && la.weekIndex < N) {
      perWeek[la.weekIndex] += la.amountCents;
    }
  }
  // How many cents each (bill, occurrence) has already committed in locked weeks.
  const occKey = (billId: string, coord: number) => `${billId}#${coord}`;
  const lockedCentsPerOcc = new Map<string, number>();
  // How many locked ROWS each occurrence has — counted separately from cents
  // because a $0 "skipped" marker row is still a row (it's what makes the
  // skip idempotent: next run sees hasLockedRows=true and writes nothing).
  const lockedRowsPerOcc = new Map<string, number>();
  for (const la of rawLocked) {
    const k = occKey(la.billId, la.occurrenceCoord);
    lockedCentsPerOcc.set(k, (lockedCentsPerOcc.get(k) ?? 0) + la.amountCents);
    lockedRowsPerOcc.set(k, (lockedRowsPerOcc.get(k) ?? 0) + 1);
  }
  // Prior-view pre-save slices (header note 6) are committed funding for
  // this view's first-week occurrences: they shrink the remainder and count
  // in the underfunded check. They sit in ANOTHER month's weeks, so they
  // never enter perWeek, and they are not rows of this month (so they don't
  // affect `hasLockedRows`).
  for (const pa of inputs.priorViewAllocations ?? []) {
    const k = occKey(pa.billId, pa.occurrenceCoord);
    lockedCentsPerOcc.set(k, (lockedCentsPerOcc.get(k) ?? 0) + pa.amountCents);
  }

  const unplaced: string[] = [];
  const underfunded: string[] = [];
  const skipped: SkippedOccurrence[] = [];

  // Any week whose payday is on/before the bill's occurrence coord is
  // eligible for placement — but only the UNLOCKED subset (`splitEligible`)
  // ever receives cents. An occurrence whose eligible weeks are ALL locked is
  // skipped this cycle (see header note 5). Leveling into a locked week was
  // the Oct 2026 bug: it added a few dollars of a bill to a past paycheck that
  // already had a row for that bill, and the duplicate insert 500'd mid-write.
  // The virtual week is never eligible for this view's own occurrences.
  const eligibleWeeks = (coord: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < N; i++) {
      if (periods[i].startDay <= coord) out.push(i);
    }
    return out;
  };

  // The natural home is where the bill actually fires. Prefer a non-locked
  // week (Phase 1 shouldn't dump a bill into a past week when the true firing
  // week is still open), but fall back to any eligible period if the natural
  // period is somehow unreachable.
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
    // Last resort: any period containing the coord (may be locked).
    for (let i = 0; i < N; i++) {
      if (coord >= periods[i].startDay && coord <= periods[i].endDay) return i;
    }
    return N - 1;
  };

  // A "unit" is one (bill, occurrence) pair. A bill can produce up to two
  // units in a view — the in-month and the forward-extended next-month one —
  // plus, with a virtual week, a PRE-SAVE unit for its next-view first-week
  // firing. Each unit is placed independently so multi-occurrence months
  // never lose a payment.
  interface WithMeta {
    bill: BillForBalance;
    coord: number;
    key: string; // billId#coord
    eligible: number[];
    /** Unlocked subset of `eligible` — the only weeks Phase 2 may level into. */
    splitEligible: number[];
    naturalIdx: number;
    amountCents: number; // remaining after locked cents
    /** True for a next-view first-week occurrence saved ahead from here. */
    isPreSave: boolean;
  }

  // An occurrence is "past-window" when its natural home period is already
  // locked (endDay < today) AND no locked allocation covers it. The paycheck
  // that would have funded it has already been received and either paid the
  // bill or was spent elsewhere — the algorithm cannot retroactively fix
  // this. These are historical data gaps, not planning failures, so they're
  // silently skipped rather than reported as underfunded.
  const pastWindowOccs = new Set<string>();

  const withMeta: WithMeta[] = [];
  for (const b of bills) {
    const occs = getBillOccurrencesInView(Number(b.dueDate), periods);
    if (occs.length === 0) {
      unplaced.push(b.id);
      continue;
    }
    const fullCents = Math.round(b.amount * 100);
    for (const occ of occs) {
      const key = occKey(b.id, occ.coord);
      const lockedCents = lockedCentsPerOcc.get(key) ?? 0;
      const remainingCents = fullCents - lockedCents;
      if (remainingCents <= 0) continue; // fully funded by locked rows
      const eligible = eligibleWeeks(occ.coord);
      if (eligible.length === 0) {
        // Distinguish past-window (natural home locked, algorithm can't
        // retroactively touch it) from a real placement failure (occurrence
        // in a future period that we somehow can't cover).
        const naturalIdxIgnoringLocks = periods.findIndex(
          (p) => occ.coord >= p.startDay && occ.coord <= p.endDay,
        );
        const homeIdx = naturalIdxIgnoringLocks >= 0 ? naturalIdxIgnoringLocks : periods.length - 1;
        if (lockedWeeks.has(homeIdx)) {
          pastWindowOccs.add(key);
        } else {
          underfunded.push(`${b.id}@${occ.coord}`);
        }
        continue;
      }
      const splitEligible = eligible.filter((i) => !lockedWeeks.has(i));
      if (splitEligible.length === 0) {
        // Every week that could fund this occurrence has already started —
        // its paycheck is handed out. Typical causes: a bill moved/added into
        // the current week (e.g. 31st → 18th on Oct 18), or a price bump on
        // a bill due this week. Don't plan it this cycle; the next occurrence
        // is planned normally. naturalWeekIdx falls through to the locked
        // home week here because no unlocked candidate exists.
        skipped.push({
          billId: b.id,
          occurrenceCoord: occ.coord,
          weekIndex: naturalWeekIdx(occ.coord),
          skippedCents: remainingCents,
          hasLockedRows: (lockedRowsPerOcc.get(key) ?? 0) > 0,
        });
        pastWindowOccs.add(key);
        continue;
      }
      withMeta.push({
        bill: b,
        coord: occ.coord,
        key,
        eligible,
        splitEligible,
        naturalIdx: naturalWeekIdx(occ.coord),
        amountCents: remainingCents,
        isPreSave: false,
      });
    }
  }

  // Pre-save units (header note 6): every bill firing in the next view's
  // first pay week gets a unit whose natural home is the virtual week and
  // whose eligible weeks are ALL of this view's weeks (every payday here
  // precedes the firing) plus the virtual week. Rows this view already holds
  // for it in locked weeks (from an earlier run) are committed and only the
  // remainder is leveled. Never skipped: the virtual week is always open.
  if (hasVirtual) {
    for (const b of bills) {
      const pre = getPreSaveOccurrence(Number(b.dueDate), periods);
      if (!pre) continue;
      const key = occKey(b.id, pre.coord);
      const remainingCents = Math.round(b.amount * 100) - (lockedCentsPerOcc.get(key) ?? 0);
      if (remainingCents <= 0) continue;
      const eligible: number[] = [];
      for (let i = 0; i < N; i++) eligible.push(i);
      eligible.push(V);
      withMeta.push({
        bill: b,
        coord: pre.coord,
        key,
        eligible,
        splitEligible: eligible.filter((i) => i === V || !lockedWeeks.has(i)),
        naturalIdx: V,
        amountCents: remainingCents,
        isPreSave: true,
      });
    }
  }

  // Phase 1: place each occurrence in its natural period. This keeps a bill due the 1st
  // (Sep 1) in P4 instead of jumping it to P1 just because P1 has more budget
  // room, and keeps each occurrence of a multi-occurrence bill in its own
  // home period.
  const placement = new Map<string, Array<{ weekIndex: number; cents: number }>>();

  for (const w of withMeta) {
    placement.set(w.key, [{ weekIndex: w.naturalIdx, cents: w.amountCents }]);
    perWeek[w.naturalIdx] += w.amountCents;
  }

  // Phase 2: iterative split refinement. Splits act on individual OCCURRENCES —
  // splitting one occurrence of a bill doesn't touch the other.
  //
  // Each iteration:
  //   1. Find the pay week with the biggest shortfall (perWeek > budget).
  //   2. Among bills in that week not yet attempted for splitting, pick the
  //      largest splittable one (>= MIN_SPLIT_CENTS, not neverSplit, has ≥2
  //      eligible weeks).
  //   3. Redistribute its cents across ALL eligible weeks using
  //      distributeBillLevel (levels the total bill load per week).
  //   4. If the new max shortfall isn't lower, roll back and stop — we've
  //      converged to whatever the constraints allow.
  // The virtual week takes part like any other: when it is the most-shorted
  // week, its pre-save units get leveled back across this view's open weeks.
  const shortfallOf = (i: number) => Math.max(0, -( budget[i] - perWeek[i]));
  const maxShortfall = () => {
    let m = 0;
    for (let i = 0; i < W; i++) m = Math.max(m, shortfallOf(i));
    return m;
  };

  const splitAttempted = new Set<string>();
  let lastMax = maxShortfall();

  while (lastMax > 0) {
    let worstWeek = -1;
    let worstShort = 0;
    for (let i = 0; i < W; i++) {
      const s = shortfallOf(i);
      if (s > worstShort) {
        worstShort = s;
        worstWeek = i;
      }
    }
    if (worstWeek < 0) break;

    const meta = new Map(withMeta.map((w) => [w.key, w]));
    const candidates = Array.from(placement.entries())
      .filter(([key, allocs]) =>
        allocs.some((a) => a.weekIndex === worstWeek) &&
        !splitAttempted.has(key),
      )
      .map(([key, allocs]) => ({ key, allocs, w: meta.get(key)! }))
      .filter((x) =>
        x.w &&
        !x.w.bill.neverSplit &&
        x.w.splitEligible.length >= 2 &&
        x.w.amountCents >= MIN_SPLIT_CENTS,
      )
      .sort((a, b) => b.w.amountCents - a.w.amountCents);

    if (candidates.length === 0) break;

    const pick = candidates[0];
    splitAttempted.add(pick.key);

    // Compute "existing bills in each eligible week EXCLUDING the current
    // placement of the bill we're about to redistribute". distributeBillLevel
    // uses OVER-BUDGET amounts (existing - budget) so it can level not just
    // raw bill totals but shortfalls, giving weeks with more room priority.
    const existingForEligible = pick.w.splitEligible.map((i) => {
      let e = perWeek[i];
      for (const a of pick.allocs) {
        if (a.weekIndex === i) e -= a.cents;
      }
      return e;
    });

    const budgetForEligible = pick.w.splitEligible.map((i) => budget[i]);
    const overForEligible = existingForEligible.map((e, k) => e - budgetForEligible[k]);
    const alloc = distributeBillLevel(pick.w.amountCents, overForEligible);

    // Apply the new distribution: remove old allocations from perWeek, add
    // the new ones. Guarded with rollback if the reshuffle didn't help.
    for (const a of pick.allocs) perWeek[a.weekIndex] -= a.cents;
    const newAllocs: Array<{ weekIndex: number; cents: number }> = [];
    for (let k = 0; k < pick.w.splitEligible.length; k++) {
      const w = pick.w.splitEligible[k];
      const cents = alloc[k];
      if (cents > 0) {
        newAllocs.push({ weekIndex: w, cents });
        perWeek[w] += cents;
      }
    }
    if (newAllocs.length === 0) {
      // Distribution collapsed to zero cents everywhere (degenerate case) —
      // restore original placement and bail.
      for (const a of pick.allocs) perWeek[a.weekIndex] += a.cents;
      break;
    }
    placement.set(pick.key, newAllocs);

    const newMax = maxShortfall();
    if (newMax >= lastMax) {
      // Splitting this bill didn't reduce the max shortfall — roll back to
      // preserve the strictly-better previous state and stop. Prevents
      // infinite oscillation when constraints are already saturated.
      for (const a of newAllocs) perWeek[a.weekIndex] -= a.cents;
      for (const a of pick.allocs) perWeek[a.weekIndex] += a.cents;
      placement.set(pick.key, pick.allocs);
      break;
    }
    lastMax = newMax;
  }

  // Rows in the virtual week belong to the next view (its own balance writes
  // them, with the prior-view slices as committed funding), so they are left
  // out of `allocations` and reported only as a total.
  const allocations: BalanceAllocation[] = [];
  for (const w of withMeta) {
    const rows = placement.get(w.key) ?? [];
    for (const a of rows) {
      if (hasVirtual && a.weekIndex === V) continue;
      allocations.push({
        billId: w.bill.id,
        weekIndex: a.weekIndex,
        amountCents: a.cents,
        occurrenceCoord: w.coord,
      });
    }
  }

  // Invariant check: every non-past occurrence must be at least fully funded
  // (allocations + locked cents >= bill.amount). Under-funding is a
  // silent-drop bug that callers should surface (ideally via
  // `assertNoUnderfundedBills`). Over-funding by a cent or two is fine —
  // historical splits sometimes carry ±1 cent rounding artifacts and we
  // shouldn't scream about that. Past-window occurrences are exempt: they're
  // historical data gaps the algorithm can't retroactively fill.
  for (const b of bills) {
    const occs = getBillOccurrencesInView(Number(b.dueDate), periods);
    const fullCents = Math.round(b.amount * 100);
    for (const occ of occs) {
      const k = occKey(b.id, occ.coord);
      if (pastWindowOccs.has(k)) continue;
      if (underfunded.includes(k)) continue;
      const placedRows = placement.get(k) ?? [];
      const placedCents = placedRows.reduce((s, r) => s + r.cents, 0);
      const lockedCents = lockedCentsPerOcc.get(k) ?? 0;
      if (placedCents + lockedCents < fullCents) {
        underfunded.push(k);
      }
    }
  }
  // Same check for pre-save units: what this view saves ahead plus what it
  // leaves in the virtual week (plus committed rows) must cover the bill.
  for (const w of withMeta) {
    if (!w.isPreSave) continue;
    const placedCents = (placement.get(w.key) ?? []).reduce((s, r) => s + r.cents, 0);
    const lockedCents = lockedCentsPerOcc.get(w.key) ?? 0;
    if (placedCents + lockedCents < Math.round(w.bill.amount * 100)) {
      underfunded.push(w.key);
    }
  }

  return {
    allocations,
    perWeekBillCents: perWeek.slice(0, N),
    feasible: maxShortfall() === 0,
    unplaced,
    underfunded,
    skipped,
    nextViewFirstWeekBillCents: hasVirtual ? perWeek[V] : 0,
  };
}

// ── Split-personal distribution (splitAcrossWeeks Personals) ──

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
 * minus fixed personal, assigned bills, and the surplus target). When multiple
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

  // Process largest splits first so they get first pick of leftover room.
  // Smaller splits then fit into whatever remains. This mirrors the
  // "biggest-first" heuristic used by balancePayWeeks Phase 1.
  const ordered = [...splits].sort((a, b) => b.amount - a.amount);
  for (const s of ordered) {
    const totalCents = Math.round(s.amount * 100);
    const dist = distributeSplitAcrossWeeks(totalCents, room);
    perSplitPerPeriod.set(s.id, dist.perWeekCents);
    unallocatedPerSplit.set(s.id, dist.unallocatedCents);
    for (let i = 0; i < N; i++) {
      totalSplitPerPeriod[i] += dist.perWeekCents[i];
      room[i] -= dist.perWeekCents[i]; // Deduct so next iteration sees remaining room.
    }
  }

  return { perSplitPerPeriod, totalSplitPerPeriod, unallocatedPerSplit };
}

/**
 * Distributes a monthly total across pay weeks proportional to each week's
 * leftover room (income − fixed personal − assigned bills − surplus target).
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

// ── Per-period occurrence helper (single-period lookup) ──

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

// ── Income per pay period ──
// Which paychecks land in which pay week. Used to be copy-pasted into
// OverviewPage (optimizer), BudgetPage (auto-assign), CashFlowOverview and
// PersonalOverview — each with slightly different fallbacks, which is exactly
// how two pages start disagreeing about the same week's income. The fallbacks
// are now explicit inputs (`IncomeDefaults`) so each caller keeps its own
// semantics while the payday math lives in one tested place.

/**
 * Minimal shape of an income source — an `Income` row from the API, or the
 * synthetic legacy source built from AppSettings by `withLegacyIncomeFallback`.
 * Fields are loose (string | number | null) because they arrive straight off
 * the REST boundary.
 */
export interface IncomeSourceLike {
  name?: string | null;
  amount?: number | string | null;
  /** Payday weekday, 0=Sun … 6=Sat. Missing → `IncomeDefaults.payDay`. */
  payDay?: number | string | null;
  /** "WEEKLY" | "BI_WEEKLY". Missing → `IncomeDefaults.paymentCycle`. */
  paymentCycle?: string | null;
  /** Bi-weekly only: 0 = 1st/3rd/5th payday of the month, 1 = 2nd/4th. */
  payWeekOffset?: number | string | null;
}

/**
 * What a source falls back to when it doesn't set its own payDay / cycle.
 * Callers pass their historical fallbacks (primary income's cadence, legacy
 * AppSettings cadence, …) so extracting this helper changed no behavior.
 */
export interface IncomeDefaults {
  payDay: number;
  paymentCycle?: string | null;
}

/**
 * Day-of-month numbers on which an income pays out in the given month.
 * Weekly → every matching weekday. Bi-weekly → every other matching weekday,
 * starting from the first (offset 0) or second (offset 1) occurrence — the
 * offset lets two bi-weekly incomes sit on opposite weeks.
 */
export function getIncomePaydays(
  year: number,
  month: number,
  payDay: number,
  isBiWeekly: boolean,
  offset: number,
): number[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const all: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(year, month, d).getDay() === payDay) all.push(d);
  }
  return isBiWeekly ? all.filter((_, i) => i % 2 === offset) : all;
}

/**
 * The sources that pay out at least once inside `period` (a payday falling in
 * [startDay, endDay]). Returned in input order so callers can build per-source
 * breakdowns (CashFlowOverview's income tooltip) as well as totals.
 */
export function getIncomeSourcesForPeriod<T extends IncomeSourceLike>(
  sources: T[],
  period: Pick<PayPeriod, "startDay" | "endDay">,
  year: number,
  month: number,
  defaults: IncomeDefaults,
): T[] {
  return sources.filter((income) => {
    const payDay = Number(income.payDay ?? defaults.payDay);
    const isBiWeekly = (income.paymentCycle ?? defaults.paymentCycle) === "BI_WEEKLY";
    const offset = Number(income.payWeekOffset ?? 0);
    return getIncomePaydays(year, month, payDay, isBiWeekly, offset).some(
      (d) => d >= period.startDay && d <= period.endDay,
    );
  });
}

/**
 * Income landing in each pay period, in integer cents, aligned with `periods`.
 * Each source is rounded to cents individually before summing (matches the
 * original inline loops bit-for-bit). A source counts once per period even if
 * two of its paydays fall in the same period.
 */
export function computeIncomePerPeriodCents(
  sources: IncomeSourceLike[],
  periods: Pick<PayPeriod, "startDay" | "endDay">[],
  year: number,
  month: number,
  defaults: IncomeDefaults,
): number[] {
  return periods.map((period) =>
    getIncomeSourcesForPeriod(sources, period, year, month, defaults).reduce(
      (total, income) => total + Math.round((Number(income.amount) || 0) * 100),
      0,
    ),
  );
}

/**
 * Legacy first-run fallback: with no `Income` rows yet, synthesize a single
 * source from the old AppSettings cadence fields (w2Amount / paymentCycle /
 * payDay) so pages show numbers instead of $0. Used by BudgetPage and
 * CashFlowOverview; the optimizer and PersonalOverview deliberately skip it.
 */
export function withLegacyIncomeFallback<T extends IncomeSourceLike>(
  incomes: T[],
  settings: { w2Amount?: number | string | null; paymentCycle?: string | null; payDay?: number | string | null } | null | undefined,
): (T | IncomeSourceLike)[] {
  if (incomes.length > 0) return incomes;
  return [
    {
      name: "Income",
      amount: settings?.w2Amount ?? 0,
      paymentCycle: settings?.paymentCycle,
      payDay: settings?.payDay,
      payWeekOffset: 0,
    },
  ];
}
