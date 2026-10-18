"use client";

/**
 * BudgetPage — YNAB-style zero-based monthly budget orchestrator.
 *
 * Fetches every resource the Plan page needs (groups, items, subsections,
 * BudgetMonth assignments, transactions, bills, personals, BillSplit rows,
 * incomes, settings) via Refine and assembles them into the hierarchical
 * `groups` structure BudgetTable renders. Computes Ready-to-Assign for the
 * pill and hosts the four write flows: assign (manual + auto), move money,
 * add group/item/subsection, edit item. Auto-assign is the trickiest piece —
 * see handleAutoAssign for the flat/cumulative/natural-period mode dispatch.
 *
 * BudgetMonth.month is stored as an ISO string keyed on the FIRST of the
 * current calendar month at UTC — `startOfThisMonth()` produces that
 * canonical key, and `monthIso` is what gets written to the DB.
 */

import PieChartIcon from "@mui/icons-material/PieChart";
import { EmptyState } from "../shared/EmptyState";
import { useState, useMemo, useRef, useEffect } from "react";
import {
  Box,
  CircularProgress,
  Button,
  Snackbar,
  Alert,
  Paper,
  Tooltip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import {
  TOOLTIP_AMBER,
  TooltipBody,
  TooltipTitle,
  tooltipStyleProps,
} from "../../lib/tooltip-styles";
import { useList, useOne, useCreate, useUpdate } from "@refinedev/core";
import { ReadyToAssignPill } from "./ReadyToAssignPill";
import {
  BudgetTable,
  BudgetGroup,
  BudgetItem,
  BudgetSubsection,
} from "./BudgetTable";
import { AddGroupModal } from "./AddGroupModal";
import { AddItemModal } from "./AddItemModal";
import { AddSubsectionModal } from "./AddSubsectionModal";
import { EditItemModal } from "./EditItemModal";
import {
  MoveMoneyPopover,
  MoveMoneyOption,
} from "./MoveMoneyPopover";
import {
  AssignMoneyPopover,
  AssignTargetOption,
} from "./AssignMoneyPopover";
import {
  computeActivity,
  computeAvailable,
  evaluatePlanSync,
  hasPaycheckForPeriod,
  computeReadyToAssign,
  computeExpectedAssignedThroughPeriod,
  monthStart,
  resolveAutoAssignAmountForPeriod,
} from "../../lib/budget-utils";
import { resolveItemDisplay } from "../../lib/budget-display";
import { usePaymentCycle } from "../../lib/usePaymentCycle";
// Shared "$D,DDD.CC" formatter — toasts/tooltips below used to inline
// toLocaleString({ style: "currency" }), which renders identically in en-US.
import { formatMoney } from "../../lib/cents";
import {
  getPayPeriodsForMonth,
  clampDayToMonth,
  computeSplitPersonalAllocations,
  getBillAllocationCentsForPeriod,
  getBillAllocationsForBill,
  getBillOccurrencesInView,
  getBillPeriodKey,
  monthKeyOf,
  computeIncomePerPeriodCents,
  withLegacyIncomeFallback,
  BillSplitRecord,
  PayPeriod,
} from "../../lib/pay-period-utils";

// UTC-anchored first-of-month — canonical key for BudgetMonth records so
// timezone shifts never bump an assignment into the "next" month.
const startOfThisMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
};

export const BudgetPage = () => {
  const month = useMemo(() => startOfThisMonth(), []);
  const { payDay, paymentCycle } = usePaymentCycle();
  const biWeekly = paymentCycle === "BI_WEEKLY";
  // Pay periods for the currently-viewed month — drives the Auto tab of
  // AssignMoneyPopover (filtered to current-only below) and bill/personal
  // allocation math inside handleAutoAssign.
  const periods: PayPeriod[] = useMemo(
    () =>
      getPayPeriodsForMonth(
        month.getUTCFullYear(),
        month.getUTCMonth(),
        payDay,
        new Date(),
        biWeekly,
      ),
    [month, payDay, biWeekly],
  );
  // ── Modal & popover state ──
  // Each modal has its own open flag; anchors also carry the target item so
  // the popover knows what to operate on without re-querying.
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [addItemGroupId, setAddItemGroupId] = useState<string | null>(null);
  const [addSubsectionGroup, setAddSubsectionGroup] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [editItem, setEditItem] = useState<BudgetItem | null>(null);
  const [moveAnchor, setMoveAnchor] = useState<{
    item: BudgetItem;
    el: HTMLElement;
  } | null>(null);
  const [assignAnchor, setAssignAnchor] = useState<HTMLElement | null>(null);
  // Toast pattern: split message from open flag (see CLAUDE.md "Toast pattern")
  // so the text doesn't collapse during MUI Snackbar's exit animation.
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  // While a multi-step move is in flight (decrement source then increment
  // destination), the derived Ready-to-Assign value would briefly flash to a
  // positive amount between those two writes. We snapshot the pre-move RTA
  // and hold it for a short window to keep the pill visually stable.
  const [rtaHold, setRtaHold] = useState<number | null>(null);
  const rtaHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (rtaHoldTimerRef.current) clearTimeout(rtaHoldTimerRef.current);
    };
  }, []);

  // ── Data queries (Refine) ──
  // `pagination: off` because the entire budget graph is small and we need
  // it all to compute Ready-to-Assign and per-item Available in one shot.
  const { query: groupsQuery } = useList({
    resource: "BudgetCategoryGroup",
    pagination: { mode: "off" },
    sorters: [{ field: "sortOrder", order: "asc" }],
  });
  const { query: itemsQuery } = useList({
    resource: "BudgetCategoryItem",
    pagination: { mode: "off" },
    sorters: [{ field: "sortOrder", order: "asc" }],
  });
  const { query: subsectionsQuery } = useList({
    resource: "BudgetCategorySubsection",
    pagination: { mode: "off" },
    sorters: [{ field: "sortOrder", order: "asc" }],
  });
  const { query: monthsQuery } = useList({
    resource: "BudgetMonth",
    pagination: { mode: "off" },
  });
  const { query: txnsQuery } = useList({
    resource: "AccountTransaction",
    pagination: { mode: "off" },
  });
  const { query: billsQuery } = useList({
    resource: "Bill",
    pagination: { mode: "off" },
  });
  const { query: personalsQuery } = useList({
    resource: "Personal",
    pagination: { mode: "off" },
  });
  const { query: splitsQuery } = useList({
    resource: "BillSplit",
    pagination: { mode: "off" },
  });
  const { query: incomesQuery } = useList({
    resource: "Income",
    pagination: { mode: "off" },
  });
  const { query: settingsQuery } = useOne({
    resource: "AppSettings",
    id: "global",
    // Shared with usePaymentCycle; on a fresh DB (no settings row yet) both
    // 404 and their error notifications collide — CLAUDE.md "Refine notifications".
    errorNotification: false,
  });

  const { mutate: createBudgetMonth } = useCreate();
  const { mutate: updateBudgetMonth } = useUpdate();

  const allGroups = (groupsQuery.data?.data as any[]) || [];
  const allItems = (itemsQuery.data?.data as any[]) || [];
  const allSubsections = (subsectionsQuery.data?.data as any[]) || [];
  const allMonths = (monthsQuery.data?.data as any[]) || [];
  const allTxns = (txnsQuery.data?.data as any[]) || [];
  const bills = (billsQuery.data?.data as any[]) || [];
  const personals = (personalsQuery.data?.data as any[]) || [];
  const splitRowsRaw = (splitsQuery.data?.data as any[]) || [];
  const incomes = (incomesQuery.data?.data as any[]) || [];
  const settings = (settingsQuery.data?.data as any) || {};

  const viewYear = month.getUTCFullYear();
  const viewMonth = month.getUTCMonth();
  // Clamp dueDate to the actual last day of the current month. A bill dated
  // the 31st in a 30-day month becomes the 30th here — prevents "phantom
  // Oct 1" firings that would come from raw day-31 arithmetic.
  const clampedBills = bills.map((b: any) => ({
    ...b,
    dueDate: clampDayToMonth(Number(b.dueDate), viewYear, viewMonth),
  }));

  const monthIso = month.toISOString();

  const getAssignment = (itemId: string, m: Date) => {
    const key = m.toISOString();
    return allMonths.find(
      (a) => a.categoryItemId === itemId && a.month === key,
    );
  };

  // Cumulative Available = sum of (assigned - activity) from the item's
  // earliest recorded month through `target`. YNAB semantics: unspent money
  // rolls forward month over month rather than resetting each month. We
  // walk month-by-month rather than aggregating in SQL because activity is
  // computed from the flat transaction list per month.
  const computeAvailableChain = (itemId: string, target: Date): number => {
    let cumulative = 0;
    const earliest = (() => {
      const dates = allMonths
        .filter((m) => m.categoryItemId === itemId)
        .map((m) => new Date(m.month));
      if (dates.length === 0) return target;
      const min = dates.reduce((a, b) => (a < b ? a : b));
      return min < target ? min : target;
    })();
    let cursor = monthStart(earliest);
    while (cursor.getTime() <= target.getTime()) {
      const a =
        allMonths.find(
          (m) =>
            m.categoryItemId === itemId &&
            new Date(m.month).getTime() === cursor.getTime(),
        )?.assignedCents || 0;
      const act = computeActivity(allTxns, itemId, cursor);
      cumulative = computeAvailable({
        priorAvailable: cumulative,
        assignedCents: a,
        activityCents: act,
      });
      cursor = new Date(
        Date.UTC(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth() + 1,
          1,
        ),
      );
    }
    return cumulative;
  };

  // ── Group hierarchy assembly ──
  // Convert flat rows from Refine into the shape BudgetTable expects: groups
  // with direct items and subsections, each item enriched with assigned /
  // activity / available cents plus a display name resolved from its source.
  const groups: BudgetGroup[] = useMemo(() => {
    const toItem = (i: any): BudgetItem => {
      const assigned = getAssignment(i.id, month)?.assignedCents || 0;
      const activity = computeActivity(allTxns, i.id, month);
      const available = computeAvailableChain(i.id, month);
      const { liveName } = resolveItemDisplay(
        {
          name: i.name,
          sourceType: i.sourceType,
          sourceBillId: i.sourceBillId,
          sourcePersonalName: i.sourcePersonalName,
          customCycle: i.customCycle,
        },
        bills,
        personals,
      );
      return {
        id: i.id,
        groupId: i.groupId,
        subsectionId: i.subsectionId ?? null,
        name: liveName,
        sortOrder: i.sortOrder,
        sourceType: i.sourceType,
        sourceBillId: i.sourceBillId,
        sourcePersonalName: i.sourcePersonalName,
        customAmountCents: i.customAmountCents,
        customCycle: i.customCycle,
        assignedCents: assigned,
        activityCents: activity,
        availableCents: available,
      };
    };

    return allGroups
      .map((g): BudgetGroup => {
        const groupItems = allItems
          .filter((i) => i.groupId === g.id)
          .sort((a, b) => a.sortOrder - b.sortOrder);

        const directItems = groupItems
          .filter((i) => !i.subsectionId)
          .map(toItem);

        const subsections: BudgetSubsection[] = allSubsections
          .filter((s) => s.groupId === g.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((s) => ({
            id: s.id,
            groupId: s.groupId,
            name: s.name,
            sortOrder: s.sortOrder,
            items: groupItems
              .filter((i) => i.subsectionId === s.id)
              .map(toItem),
          }));

        return {
          id: g.id,
          name: g.name,
          sortOrder: g.sortOrder,
          items: directItems,
          subsections,
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [
    allGroups,
    allItems,
    allSubsections,
    allMonths,
    allTxns,
    bills,
    personals,
    monthIso,
  ]);

  // ── Auto-assign inputs (shared) ──
  // Consolidated in one memo so both the underfunded-badge computation and
  // handleAutoAssign consume the same billRefs / personalRefs / splits and
  // per-period split-personal slice arrays. Duplicating this logic in two
  // places would drift silently — anything that changes the auto-assign
  // resolution must change the badge threshold too.
  const autoAssignInputs = useMemo(() => {
    const billRefs = clampedBills.map((b: any) => ({
      id: b.id,
      amount: Number(b.amount),
      dueDate: Number(b.dueDate),
    }));
    const personalRefs = personals.map((p: any) => ({
      name: p.name,
      amount: Number(p.amount),
      dueDate:
        p.dueDate != null
          ? clampDayToMonth(Number(p.dueDate), viewYear, viewMonth)
          : undefined,
      weekOfMonth: p.weekOfMonth ?? null,
      repeatWeekly: Boolean(p.repeatWeekly),
      splitAcrossWeeks: Boolean(p.splitAcrossWeeks),
    }));
    const mk = monthKeyOf(viewYear, viewMonth);
    const splits: BillSplitRecord[] = splitRowsRaw.map((r: any) => ({
      billId: String(r.billId),
      monthKey: String(r.monthKey),
      weekIndex: Number(r.weekIndex),
      amountCents: Number(r.amountCents),
      occurrenceCoord: Number(r.occurrenceCoord ?? 0),
    }));

    // Income landing in each pay week (shared helper in pay-period-utils).
    // With no Income rows yet, fall back to the legacy AppSettings cadence so
    // first-run users still get numbers. Sources without their own cadence
    // inherit payDay from usePaymentCycle and the cycle from the primary
    // income, then AppSettings.
    const primaryIncome = incomes.find((i: any) => i.isPrimary);
    const incomePerPeriodCents = computeIncomePerPeriodCents(
      withLegacyIncomeFallback(incomes, settings),
      periods,
      viewYear,
      viewMonth,
      {
        payDay,
        paymentCycle: primaryIncome?.paymentCycle ?? settings.paymentCycle,
      },
    );
    const fixedPersonalPerPeriodCents = periods.map((p) =>
      personalRefs
        .filter((pb) => {
          if (pb.splitAcrossWeeks) return false;
          if (pb.repeatWeekly) return true;
          const key =
            pb.weekOfMonth != null
              ? `P${pb.weekOfMonth}`
              : getBillPeriodKey(Number(pb.dueDate ?? 1), periods);
          return key === p.key;
        })
        .reduce(
          (acc, pb) => acc + Math.round((Number(pb.amount) || 0) * 100),
          0,
        ),
    );
    const billsPerPeriodCents = periods.map((p) =>
      billRefs.reduce(
        (acc, b) =>
          acc +
          getBillAllocationCentsForPeriod(
            b.id,
            Number(b.dueDate),
            Number(b.amount),
            periods,
            mk,
            splits,
            p.key,
          ),
        0,
      ),
    );
    const targetSurplusCents = Number(settings?.wifeWeeklyTargetCents ?? 30000);
    const splitPersonalRefs = personalRefs.filter((pb) => pb.splitAcrossWeeks);
    const splitAlloc = computeSplitPersonalAllocations({
      periods,
      incomePerPeriodCents,
      fixedPersonalPerPeriodCents,
      billsPerPeriodCents,
      targetSurplusCents,
      splits: splitPersonalRefs.map((pb) => ({
        id: pb.name,
        amount: Number(pb.amount) || 0,
      })),
    });
    // Full per-period slice arrays keyed by personal name — the badge helper
    // needs to see slices through each period as it walks 0..currentIdx.
    const splitAllocationsByPersonalNameThroughPeriod: Record<string, number[]> = {};
    splitPersonalRefs.forEach((pb) => {
      splitAllocationsByPersonalNameThroughPeriod[pb.name] =
        splitAlloc.perSplitPerPeriod.get(pb.name) ?? [];
    });
    return {
      billRefs,
      personalRefs,
      splits,
      monthKey: mk,
      splitAllocationsByPersonalNameThroughPeriod,
    };
  }, [
    clampedBills,
    personals,
    splitRowsRaw,
    periods,
    incomes,
    settings,
    viewYear,
    viewMonth,
    payDay,
  ]);

  // ── Current pay-week index ──
  // The last period whose startDay is on or before today's day-of-month. -1
  // when today is before the month's first payday (no pay week has started
  // yet, so no envelope should be flagged as underfunded). Because the Plan
  // is pinned to startOfThisMonth, "today" and "the view's month" match.
  const currentPayWeekIdx = useMemo(() => {
    const today = new Date();
    const isSameMonth =
      today.getFullYear() === viewYear && today.getMonth() === viewMonth;
    if (!isSameMonth) return periods.length - 1;
    const dom = today.getDate();
    let idx = -1;
    periods.forEach((p, i) => {
      if (p.startDay <= dom) idx = i;
    });
    return idx;
  }, [periods, viewYear, viewMonth]);

  // ── Payday pending ──
  // True when today is inside the current pay week but that week's paycheck
  // (an uncategorized inflow with memo "Income") hasn't been recorded yet.
  // While pending, the Plan only flags envelopes that are short of what
  // EARLIER pay weeks should have funded — this week's slices can't be
  // funded before the money arrives, so warning about them on payday
  // morning is just noise. See `evaluatePlanSync`.
  const paydayPending = useMemo(() => {
    if (currentPayWeekIdx < 0) return false;
    const today = new Date();
    const isSameMonth =
      today.getFullYear() === viewYear && today.getMonth() === viewMonth;
    if (!isSameMonth) return false;
    const pad = (n: number) => String(n).padStart(2, "0");
    const periodStartISO = `${viewYear}-${pad(viewMonth + 1)}-${pad(periods[currentPayWeekIdx].startDay)}`;
    const todayISO = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    return !hasPaycheckForPeriod({ transactions: allTxns, periodStartISO, todayISO });
  }, [currentPayWeekIdx, periods, viewYear, viewMonth, allTxns]);

  // ── Bill payment grace windows ──
  // For each bill, enumerate its occurrences in this view and compute a real-
  // calendar window [dueDate, dueDate + BILL_PAYMENT_GRACE_DAYS] per occurrence.
  // A transaction dated inside any of these windows is considered payment for
  // that occurrence. Grace exists because banks post charges a few days after
  // the vendor's stated due date — a Sep 1 charge for a bill due Aug 31 should
  // still be attributed to Aug's envelope, not September's.
  //
  // Windows are per-occurrence (a bill firing twice in a view gets two
  // separate windows), so multi-occurrence bills (e.g. one due the 1st in the Sept view)
  // (Sep 1 + Oct 1) attribute payments to the right occurrence.
  const BILL_PAYMENT_GRACE_DAYS = 5;
  // Windows are stored as YYYY-MM-DD string ranges (inclusive) so grace-window
  // membership is a pure calendar-date comparison against the DATE PART of the
  // txn's ISO. Using local-time Date objects here + parsing txn.date with
  // `new Date(...)` mixed timezones and mis-classified txns dated on the due
  // date itself (e.g. txn "2026-09-04T01:57Z" is midnight-plus in UTC, so it
  // was Sep 3 late night in PDT — comparison against local-midnight Sep 4
  // start excluded it and the underfunded badge would fire even though the
  // envelope was fully funded and paid).
  // Each window also carries its occurrence `coord` so the enrich pass can
  // look up that occurrence's planned (split) amount.
  const graceWindowsPerBill: Record<
    string,
    Array<{ start: string; end: string; coord: number }>
  > = useMemo(() => {
    const daysInViewMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const toDateStr = (y: number, m: number, d: number): string => {
      // Date constructor handles month/day overflow (e.g. Aug 31 + 5 → Sep 5),
      // then we read UTC components so no local-tz shift can slip in.
      const dt = new Date(Date.UTC(y, m, d));
      const yy = dt.getUTCFullYear();
      const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(dt.getUTCDate()).padStart(2, "0");
      return `${yy}-${mm}-${dd}`;
    };
    const result: Record<string, Array<{ start: string; end: string; coord: number }>> = {};
    for (const bill of clampedBills) {
      const occurrences = getBillOccurrencesInView(Number(bill.dueDate), periods);
      result[bill.id] = occurrences.map((o) => {
        // coord ≤ daysInMonth: real date is (viewYear, viewMonth, coord)
        // coord > daysInMonth: real date is next calendar month, day (coord - daysInMonth)
        const inNext = o.coord > daysInViewMonth;
        const realYear = inNext && viewMonth === 11 ? viewYear + 1 : viewYear;
        const realMonth = inNext ? (viewMonth === 11 ? 0 : viewMonth + 1) : viewMonth;
        const realDay = inNext ? o.coord - daysInViewMonth : o.coord;
        return {
          start: toDateStr(realYear, realMonth, realDay),
          end: toDateStr(realYear, realMonth, realDay + BILL_PAYMENT_GRACE_DAYS),
          coord: o.coord,
        };
      });
    }
    return result;
  }, [clampedBills, periods, viewYear, viewMonth]);

  // ── Enrich items with expectedAssignedCents + activityInBillGraceWindowCents ──
  // Second pass over the group tree: for every item, compute (a) the plan's
  // expected cumulative funding through the current pay week and (b) for
  // BILL envelopes, the subset of activity that falls inside the bill's
  // grace windows. BudgetItemRow uses these two to render an underfunded
  // warning icon when funded (available + grace-window activity) lags
  // expected. Done as a separate pass so `groups` (heavier deps) doesn't
  // have to re-run when only period math changes.
  const groupsWithExpected: BudgetGroup[] = useMemo(() => {
    const enrich = (it: BudgetItem): BudgetItem => {
      // For BILL envelopes, sum only the txns landing in a grace window —
      // this excludes spillover payments for the PREVIOUS month's occurrence
      // that happen to land in this calendar month (e.g. Aug 1 payment of a
      // bill due Jul 31 should not count as Aug's envelope activity).
      //
      // Paid occurrence = settled: once a window has ANY net outflow, that
      // occurrence is credited with its full PLANNED amount (the sum of its
      // BillSplit rows, or bill.amount when unsplit) regardless of what was
      // actually charged. This handles both directions of estimate drift:
      //   - Overpay (charged $96.66 vs a $96 plan) → credited $96, so
      //     the overpayment doesn't silently eat into another firing's
      //     "still-to-save" target (e.g. the Oct 5 forward-extension).
      //   - Underpay (a bill planned $80.50, charged $79.60) → credited
      //     $80.50, so the $0.90 difference doesn't show as a phantom
      //     "under-funded" warning. The plan split lives in a locked past
      //     week, so updating the bill amount + re-optimizing can't fix it.
      //     Leftover change in the envelope then flags as OVER-funded, which
      //     is the correct nudge to move it elsewhere.
      // The Sync-Plan target reflects the Overview plan verbatim; real
      // over/under charges are a checking-account matter, not envelope-level
      // bookkeeping.
      let activityInBillGraceWindowCents: number | undefined = undefined;
      if (it.sourceType === "BILL" && it.sourceBillId) {
        const windows = graceWindowsPerBill[it.sourceBillId] ?? [];
        const bill = clampedBills.find((b: any) => b.id === it.sourceBillId);
        // Planned cents per occurrence coord, straight from the same
        // allocation helper the expected-through-period math uses.
        const plannedCentsByCoord = new Map<number, number>();
        if (bill) {
          for (const a of getBillAllocationsForBill(
            bill.id,
            Number(bill.dueDate),
            Number(bill.amount),
            periods,
            autoAssignInputs.monthKey,
            autoAssignInputs.splits,
          )) {
            plannedCentsByCoord.set(
              a.occurrenceCoord,
              (plannedCentsByCoord.get(a.occurrenceCoord) ?? 0) + a.amountCents,
            );
          }
        }
        const itemTxns = allTxns.filter((t: any) => t.categoryItemId === it.id);
        const toDateStr = (t: any): string =>
          // Compare on the ISO date part (YYYY-MM-DD) — the calendar date
          // the user picked in the txn form. Parsing to a Date and comparing
          // against local-midnight bounds silently drops txns whose UTC time
          // straddles local midnight (see graceWindowsPerBill comment).
          typeof t.date === "string"
            ? t.date.slice(0, 10)
            : new Date(t.date).toISOString().slice(0, 10);
        activityInBillGraceWindowCents = windows.reduce((sum, w) => {
          const rawWindowActivity = itemTxns
            .filter((t: any) => {
              const dateStr = toDateStr(t);
              return dateStr >= w.start && dateStr <= w.end;
            })
            .reduce(
              (s: number, t: any) => s + (t.outflowCents || 0) - (t.inflowCents || 0),
              0,
            );
          // Only snap real payments (positive net outflow) to the plan.
          // Zero (unpaid) and negative net (refunds > payments) pass through.
          const plannedCents = plannedCentsByCoord.get(w.coord);
          const credited =
            rawWindowActivity > 0 && plannedCents != null
              ? plannedCents
              : rawWindowActivity;
          return sum + credited;
        }, 0);
      }
      // Compute expected cumulative through BOTH the current and previous
      // pay weeks. The previous-period value is what powers the payday-
      // suppression heuristic in BudgetItemRow / syncPlan: if the previous
      // week's target is already met, an under-fund shortfall against the
      // current week is treated as "haven't done today's payday budgeting
      // yet" rather than real drift, and the warning is silenced.
      const commonInputs = {
        item: {
          id: it.id,
          sourceType: it.sourceType as "BILL" | "PERSONAL_NAME" | "CUSTOM",
          sourceBillId: it.sourceBillId,
          sourcePersonalName: it.sourcePersonalName,
          customAmountCents: it.customAmountCents,
          customCycle: it.customCycle,
        },
        periods,
        bills: autoAssignInputs.billRefs,
        personals: autoAssignInputs.personalRefs,
        splits: autoAssignInputs.splits,
        monthKey: autoAssignInputs.monthKey,
        splitAllocationsByPersonalNameThroughPeriod:
          autoAssignInputs.splitAllocationsByPersonalNameThroughPeriod,
      };
      return {
        ...it,
        expectedAssignedCents: computeExpectedAssignedThroughPeriod({
          ...commonInputs,
          throughPeriodIdx: currentPayWeekIdx,
        }),
        expectedAssignedThroughPreviousCents:
          computeExpectedAssignedThroughPeriod({
            ...commonInputs,
            // At currentPayWeekIdx = 0 (start of month, no previous period
            // in view), the helper returns 0 for negative indices — which
            // makes previousMet naturally true and correctly suppresses
            // stale warnings for the first pay week too.
            throughPeriodIdx: currentPayWeekIdx - 1,
          }),
        activityInBillGraceWindowCents,
        paydayPending,
      };
    };
    return groups.map((g) => ({
      ...g,
      items: g.items.map(enrich),
      subsections: g.subsections.map((s) => ({ ...s, items: s.items.map(enrich) })),
    }));
  }, [groups, autoAssignInputs, currentPayWeekIdx, periods, graceWindowsPerBill, allTxns, clampedBills, paydayPending]);

  // Flatten every item (direct + subsectioned) for lookups by id — used by
  // handleMoveMoney, handleManualAssign, and handleAutoAssign.
  const allFlatItems = groupsWithExpected.flatMap((g) => [
    ...g.items,
    ...g.subsections.flatMap((s) => s.items),
  ]);

  const readyToAssign = useMemo(
    () =>
      computeReadyToAssign({
        transactions: allTxns,
        assignments: allMonths,
      }),
    [allTxns, allMonths],
  );

  // Set the total assigned amount for this item this month. Upserts because
  // an item may not yet have a BudgetMonth row (default = 0). All writes
  // suppress Refine's success notification — the page uses a single toast.
  const upsertAssignment = (itemId: string, newCents: number) => {
    const existing = getAssignment(itemId, month);
    if (existing) {
      updateBudgetMonth(
        {
          resource: "BudgetMonth",
          id: existing.id,
          values: { assignedCents: newCents },
          successNotification: false,
        },
      );
    } else {
      createBudgetMonth(
        {
          resource: "BudgetMonth",
          values: {
            month: monthIso,
            categoryItemId: itemId,
            assignedCents: newCents,
          },
          successNotification: false,
        },
      );
    }
  };

  // ── Auto-assign for a chosen pay week ──
  // Walks every budget item and computes a "target" assignment amount for
  // this pay period, then either sets it flat or tops up available depending
  // on whether the item is a repeating (weekly) or one-shot (monthly) source.
  // See AssignMoneyPopover's docblock for the three-mode summary.
  const handleAutoAssign = (targetPeriod: PayPeriod) => {
    let count = 0;
    let totalCents = 0;
    const {
      billRefs,
      personalRefs,
      splits,
      monthKey,
      splitAllocationsByPersonalNameThroughPeriod,
    } = autoAssignInputs;
    const targetPeriodIdx = periods.findIndex((p) => p.key === targetPeriod.key);
    // Cumulative allocation through the target period — the auto-assign
    // top-up logic treats this as the running total that Available should
    // reach after this week. Auto-assigning a later week without doing the
    // earlier ones simply pulls the whole cumulative slice at once.
    const splitAllocationsByPersonalName: Record<string, number> = {};
    Object.entries(splitAllocationsByPersonalNameThroughPeriod).forEach(
      ([name, slices]) => {
        splitAllocationsByPersonalName[name] = slices
          .slice(0, targetPeriodIdx + 1)
          .reduce((a, b) => a + b, 0);
      },
    );

    // ── Per-item application loop ──
    // resolveAutoAssignAmountForPeriod encapsulates the mode-specific target
    // computation — this loop is only responsible for translating that target
    // into the correct write (flat add vs. cumulative top-up).
    allFlatItems.forEach((it) => {
      const target = resolveAutoAssignAmountForPeriod({
        item: {
          id: it.id,
          sourceType: it.sourceType as "BILL" | "PERSONAL_NAME" | "CUSTOM",
          sourceBillId: it.sourceBillId,
          sourcePersonalName: it.sourcePersonalName,
          customAmountCents: it.customAmountCents,
          customCycle: it.customCycle,
        },
        periodKey: targetPeriod.key,
        periods,
        bills: billRefs,
        personals: personalRefs,
        splits,
        monthKey,
        splitAllocationsByPersonalName,
      });
      if (target <= 0) return;
      // Repeating items (custom cycle-null, personal repeatWeekly) get a fresh
      // target every pay period — compare the monthly assignment against the
      // cumulative expectation (target × periods so far). Non-repeating items
      // (bills, dated personals) fire once per month, so top up available.
      const personalMatch =
        it.sourceType === "PERSONAL_NAME"
          ? personalRefs.find((p) => p.name === it.sourcePersonalName)
          : null;
      const isRepeating =
        (it.sourceType === "CUSTOM" && it.customCycle == null) ||
        (it.sourceType === "PERSONAL_NAME" && Boolean(personalMatch?.repeatWeekly));
      let needed: number;
      if (isRepeating) {
        // Weekly allowances and recurring items: always add one period's flat
        // amount. Cumulative top-up is unreliable when existing assignments
        // from prior sessions are non-zero.
        needed = target;
      } else if (it.sourceType === "BILL") {
        // Mirror the sync-plan / underfunded-badge formula so Auto and Sync
        // agree envelope-by-envelope. Subtract the bill's grace-window activity
        // from the target — money that has already left checking for this
        // occurrence shouldn't be re-funded on Auto. Otherwise Auto P3 refunds
        // every bill that fired earlier in the month and was paid ("wrong
        // spots" bug). Compare against raw availableCents (no Math.max clamp):
        // a negative available represents a real hole the bill drilled into
        // this envelope, and Auto is the tool to refill it.
        const graceActivity = Math.max(
          0,
          it.activityInBillGraceWindowCents ?? 0,
        );
        const effectiveTarget = Math.max(0, target - graceActivity);
        needed = effectiveTarget - it.availableCents;
      } else {
        needed = target - Math.max(0, it.availableCents);
      }
      if (needed <= 0) return;
      upsertAssignment(it.id, it.assignedCents + needed);
      count++;
      totalCents += needed;
    });
    setToastMsg(`Assigned ${formatMoney(totalCents)} across ${count} items for ${targetPeriod.label}`);
    setToastOpen(true);
  };

  // Move funds between categories. destItemId=null means "back to Ready to
  // Assign" — done implicitly by only decrementing the source. Fires two
  // writes for cat-to-cat moves; snapshots RTA to prevent the flash-of-green
  // that would otherwise appear between the decrement and the increment.
  const handleMoveMoney = (params: {
    sourceItemId: string;
    destItemId: string | null;
    amountCents: number;
  }) => {
    const src = allFlatItems.find((i) => i.id === params.sourceItemId);
    if (!src) {
      setMoveAnchor(null);
      return;
    }
    // Snapshot the RTA before the two-step write so the pill stays stable
    // (avoids the green "Ready to Assign" flash between the decrement and
    // increment when moving between categories).
    if (params.destItemId) {
      setRtaHold(readyToAssign);
      if (rtaHoldTimerRef.current) clearTimeout(rtaHoldTimerRef.current);
      rtaHoldTimerRef.current = setTimeout(() => setRtaHold(null), 700);
    }
    upsertAssignment(src.id, src.assignedCents - params.amountCents);
    if (params.destItemId) {
      const dst = allFlatItems.find((i) => i.id === params.destItemId);
      if (dst)
        upsertAssignment(dst.id, dst.assignedCents + params.amountCents);
    }
    // When destItemId is null, money flows back into Ready to Assign by virtue
    // of the source's reduced assignment (RTA = uncategorized inflows - assignments).
    setMoveAnchor(null);
  };

  // Flatten the group tree into MoveMoneyPopover's option list. Grouping key
  // includes the subsection name ("Group / Subsection") so the popover's
  // Autocomplete groups options in the same shape as the Plan renders them.
  const moveOptions: MoveMoneyOption[] = useMemo(() => {
    const buildName = (it: BudgetItem) =>
      resolveItemDisplay(
        {
          name: it.name,
          sourceType: it.sourceType,
          sourceBillId: it.sourceBillId,
          sourcePersonalName: it.sourcePersonalName,
          customCycle: it.customCycle,
        },
        clampedBills,
        personals,
      ).displayName;
    const result: MoveMoneyOption[] = [];
    groups.forEach((g) => {
      // Interleave direct items and subsections at the group level by sortOrder
      // so the popover lists them in the same order the Plan shows.
      type Row =
        | { kind: "item"; item: BudgetItem; sortOrder: number }
        | { kind: "sub"; sub: BudgetSubsection; sortOrder: number };
      const rows: Row[] = [
        ...g.items.map((item) => ({
          kind: "item" as const,
          item,
          sortOrder: item.sortOrder,
        })),
        ...g.subsections.map((sub) => ({
          kind: "sub" as const,
          sub,
          sortOrder: sub.sortOrder,
        })),
      ];
      rows.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.kind === "item" ? -1 : 1;
      });
      rows.forEach((row) => {
        if (row.kind === "item") {
          result.push({
            itemId: row.item.id,
            itemName: buildName(row.item),
            availableCents: row.item.availableCents,
            groupId: g.id,
            groupName: g.name,
          });
        } else {
          row.sub.items.forEach((it) => {
            result.push({
              itemId: it.id,
              itemName: buildName(it),
              availableCents: it.availableCents,
              groupId: g.id,
              groupName: `${g.name} / ${row.sub.name}`,
            });
          });
        }
      });
    });
    return result;
  }, [groups, bills, personals]);

  const assignOptions: AssignTargetOption[] = moveOptions;

  // Manual assign from the Manually tab in AssignMoneyPopover — always ADDS
  // to the current assignedCents (not sets), matching the popover UX which
  // frames the input as "assign this much" rather than "make it this much".
  const handleManualAssign = (params: {
    itemId: string;
    amountCents: number;
  }) => {
    const item = allFlatItems.find((i) => i.id === params.itemId);
    if (!item) return;
    upsertAssignment(item.id, item.assignedCents + params.amountCents);
    setAssignAnchor(null);
    setToastMsg(`Assigned ${formatMoney(params.amountCents)} to ${item.name}`);
    setToastOpen(true);
  };

  // ── Sync Plan computation ──
  // Walks every item and figures out how much each envelope needs to shift
  // (assigned +/-) to bring it in line with the plan schedule — via the same
  // `evaluatePlanSync` helper BudgetItemRow uses for the out-of-sync badge. Positive delta = add to assignment (under-funded),
  // negative delta = subtract from assignment (over-funded, extra pulled
  // back to Ready to Assign).
  //
  // `canSync` gates the button: over-funded pulls REPLENISH RTA before
  // under-funded items draw from it, so the check is (RTA + overTotal) >=
  // underTotal. When true, applying every delta leaves the RTA at
  // (RTA + overTotal - underTotal) ≥ 0.
  //
  // Zero tolerance — envelope funding is integer cents throughout, so any
  // non-zero diff is real drift. Overview plan is the source of truth.
  const syncPlan = useMemo(() => {
    const perItem: Array<{ itemId: string; deltaCents: number }> = [];
    let overTotalCents = 0;
    let underTotalCents = 0;
    allFlatItems.forEach((it) => {
      // Shared with BudgetItemRow's badge — see evaluatePlanSync. The button
      // only picks up over-funding and real drift (short of EARLIER pay
      // weeks' targets). Shortfalls that exist only because this week's
      // slice hasn't been assigned yet are Auto-assign's job, so they never
      // surface the Sync Plan button.
      const r = evaluatePlanSync({
        sourceType: it.sourceType,
        expectedFullCents: it.expectedAssignedCents ?? 0,
        expectedPreviousFullCents: it.expectedAssignedThroughPreviousCents ?? 0,
        graceActivityCents: it.activityInBillGraceWindowCents,
        availableCents: it.availableCents,
        activityCents: it.activityCents,
        paydayPending: it.paydayPending ?? false,
      });
      if (!r.needsSync || r.syncDeltaCents === 0) return;
      // delta = how much to ADD to assignedCents.
      // negative → over-funded → pull back to RTA
      // positive → drift → fill from RTA
      perItem.push({ itemId: it.id, deltaCents: r.syncDeltaCents });
      if (r.syncDeltaCents < 0) overTotalCents += -r.syncDeltaCents;
      else underTotalCents += r.syncDeltaCents;
    });
    const canSync = readyToAssign + overTotalCents >= underTotalCents;
    // Shortfall shown in the disabled-button tooltip — never negative.
    const shortfallCents = Math.max(
      0,
      underTotalCents - overTotalCents - readyToAssign,
    );
    return {
      perItem,
      overTotalCents,
      underTotalCents,
      canSync,
      shortfallCents,
      hasWork: perItem.length > 0,
    };
  }, [allFlatItems, readyToAssign]);

  // Apply every sync delta in one batch. Fire-and-forget mutations — Refine
  // + Prisma handle them independently, and the derived RTA re-computes once
  // all writes land. We don't order the writes because the mutations don't
  // observe each other's intermediate state.
  const handleSyncPlan = () => {
    if (!syncPlan.canSync || !syncPlan.hasWork) return;
    syncPlan.perItem.forEach(({ itemId, deltaCents }) => {
      const item = allFlatItems.find((i) => i.id === itemId);
      if (!item) return;
      upsertAssignment(itemId, item.assignedCents + deltaCents);
    });
    const netMovedCents = syncPlan.underTotalCents + syncPlan.overTotalCents;
    setToastMsg(
      `Synced ${syncPlan.perItem.length} envelope${syncPlan.perItem.length === 1 ? "" : "s"} with plan (${formatMoney(netMovedCents)} shifted)`,
    );
    setToastOpen(true);
  };

  const isLoading =
    groupsQuery.isLoading ||
    itemsQuery.isLoading ||
    subsectionsQuery.isLoading ||
    monthsQuery.isLoading ||
    txnsQuery.isLoading ||
    splitsQuery.isLoading ||
    incomesQuery.isLoading ||
    settingsQuery.isLoading;

  return (
    <Box
      sx={{
        height: "100%",
        p: 4,
        display: "flex",
        flexDirection: "column",
        gap: 3,
        minHeight: 0,
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 2,
        }}
      >
        <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
          {/* Hidden until every query has loaded — mid-load the sync math runs
              on partial data (e.g. transactions without assignments) and the
              button would flash in and out on app launch. */}
          {!isLoading && syncPlan.hasWork && (
            // Tooltip wraps a <span> because MUI Tooltips don't fire on
            // disabled buttons — span stays in the DOM to catch pointer events
            // even when the underlying button is greyed out.
            <Tooltip
              placement="bottom"
              arrow
              {...tooltipStyleProps(TOOLTIP_AMBER)}
              title={
                <>
                  <TooltipTitle color={TOOLTIP_AMBER}>
                    {syncPlan.canSync ? "Sync plan to schedule" : "Not enough to sync"}
                  </TooltipTitle>
                  <TooltipBody>
                    {syncPlan.canSync
                      ? `Pull ${formatMoney(syncPlan.overTotalCents)} back to Ready to Assign and top up ${formatMoney(syncPlan.underTotalCents)} across ${syncPlan.perItem.length} envelope${syncPlan.perItem.length === 1 ? "" : "s"}.`
                      : `Ready to Assign is short ${formatMoney(syncPlan.shortfallCents)} to fully sync the plan.`}
                  </TooltipBody>
                </>
              }
            >
              <span>
                <Button
                  variant="outlined"
                  size="small"
                  disableElevation
                  disabled={!syncPlan.canSync}
                  onClick={handleSyncPlan}
                  startIcon={<AutoFixHighIcon sx={{ fontSize: 14 }} />}
                  // Amber palette matches the ⚠ warning icon on out-of-sync
                  // envelopes and the tooltip outline — this button is the
                  // corresponding action, so the color ties them together.
                  sx={{
                    fontWeight: 800,
                    borderRadius: 2,
                    fontSize: "0.75rem",
                    borderColor: "rgba(251, 191, 36, 0.45)",
                    color: "#fbbf24",
                    "&:hover": {
                      borderColor: "#fbbf24",
                      bgcolor: "rgba(251, 191, 36, 0.08)",
                    },
                    // Fade the amber to muted grey when disabled so it
                    // reads as "not available" without losing the shape.
                    "&.Mui-disabled": {
                      borderColor: "rgba(251, 191, 36, 0.15)",
                      color: "rgba(251, 191, 36, 0.35)",
                    },
                  }}
                >
                  Sync Plan
                </Button>
              </span>
            </Tooltip>
          )}
        </Box>
        {/* `visibility: hidden` (not unmount) while loading: keeps the grid
            column's width so nothing shifts, but shows no amount. On launch the
            transactions query resolves before BudgetMonth, so for a frame RTA =
            all inflows − $0 assigned — that was the "$20k Ready to Assign"
            flash seen in PROD (Oct 2026). Hidden elements aren't clickable. */}
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            visibility: isLoading ? "hidden" : "visible",
          }}
          aria-hidden={isLoading || undefined}
        >
          <ReadyToAssignPill
            cents={rtaHold ?? readyToAssign}
            onAssignClick={(el) => setAssignAnchor(el)}
          />
        </Box>
        <Box
          sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}
        >
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => setAddGroupOpen(true)}
            sx={{ fontWeight: 700, borderRadius: 2 }}
          >
            Add Group
          </Button>
        </Box>
      </Box>

      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}>
          <CircularProgress />
        </Box>
      ) : groups.length === 0 ? (
        // First-run card (shared EmptyState) — explains the zero-based Plan.
        <EmptyState
          icon={<PieChartIcon />}
          accent="#818cf8"
          title="Build your Plan"
          description="The Plan is a zero-based budget: every dollar from your paycheck gets a job. Create a group such as Bills or Everyday, then add your bills and personal expenses to it so you can fund each one on payday."
          actionLabel="Create your first group"
          onAction={() => setAddGroupOpen(true)}
        />
      ) : (
        <Paper
          elevation={0}
          sx={{
            p: { xs: 2, md: 3 },
            borderRadius: 4,
            bgcolor: "rgba(30, 41, 59, 0.5)",
            border: "1px solid rgba(129, 140, 248, 0.1)",
            overflow: "hidden",
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <BudgetTable
            groups={groupsWithExpected}
            bills={clampedBills}
            personals={personals}
            periods={periods}
            onAvailableClick={(item, el) => setMoveAnchor({ item, el })}
            onAddItem={(groupId) => setAddItemGroupId(groupId)}
            onAddSubsection={(group) => setAddSubsectionGroup(group)}
            onEditItem={(item) => setEditItem(item)}
          />
        </Paper>
      )}

      <AddGroupModal
        open={addGroupOpen}
        onClose={() => setAddGroupOpen(false)}
        nextSortOrder={allGroups.length}
      />
      <AddItemModal
        open={!!addItemGroupId}
        groupId={addItemGroupId}
        nextSortOrder={
          addItemGroupId
            ? allItems.filter((i) => i.groupId === addItemGroupId).length
            : 0
        }
        onClose={() => setAddItemGroupId(null)}
      />
      <AddSubsectionModal
        open={!!addSubsectionGroup}
        groupId={addSubsectionGroup?.id ?? null}
        groupName={addSubsectionGroup?.name}
        nextSortOrder={
          addSubsectionGroup
            ? allSubsections.filter(
                (s) => s.groupId === addSubsectionGroup.id,
              ).length
            : 0
        }
        onClose={() => setAddSubsectionGroup(null)}
      />
      <EditItemModal
        open={!!editItem}
        item={editItem}
        onClose={() => setEditItem(null)}
      />
      <MoveMoneyPopover
        open={!!moveAnchor}
        anchorEl={moveAnchor?.el || null}
        sourceItemId={moveAnchor?.item.id || ""}
        sourceName={moveAnchor?.item.name || ""}
        sourceAvailableCents={moveAnchor?.item.availableCents || 0}
        options={moveOptions}
        onClose={() => setMoveAnchor(null)}
        onMove={handleMoveMoney}
      />
      <AssignMoneyPopover
        open={!!assignAnchor}
        anchorEl={assignAnchor}
        options={assignOptions}
        // Only the current pay week(s) appear in the Auto tab — auto-assigning
        // to past/future weeks from the Plan page has no meaningful semantic.
        periods={periods.filter((p) => p.isCurrent)}
        onClose={() => setAssignAnchor(null)}
        onManualAssign={handleManualAssign}
        onAutoAssign={handleAutoAssign}
      />
      <Snackbar
        open={toastOpen}
        autoHideDuration={3000}
        onClose={() => setToastOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        slotProps={{ transition: { onExited: () => setToastMsg("") } }}
      >
        <Alert
          severity="success"
          variant="filled"
          onClose={() => setToastOpen(false)}
        >
          {toastMsg}
        </Alert>
      </Snackbar>
    </Box>
  );
};
