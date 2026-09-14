"use client";

/**
 * OverviewPage — the main dashboard.
 *
 * Renders the pay-period cash-flow view, the bill schedule, personal-expense
 * cards, weekly surplus target, and the yearly-cost overview. Also hosts the
 * Optimize action which re-runs `balancePayWeeks` across the next 36 months
 * and rewrites `BillSplit` rows so each pay week gets a per-occurrence share
 * of every bill.
 *
 * Data sources (all via Refine.dev useList/useOne):
 *   - Bill, Personal, YearlyCost, Income  → recurring cost inputs
 *   - AppSettings                          → surplus weekly target, misc
 *   - BillSplit                            → per-week allocations written by Optimize
 *
 * Key invariants and gotchas documented inline near the code that enforces
 * them (locked-week semantics, legacy split migration, hooks-order rule,
 * multi-occurrence handling). See CLAUDE.md → "Overview optimizer" and the
 * pay-period-utils tests for the full contract.
 */

import { useMemo, useState, useEffect, useRef } from "react";
import {
  useList,
  BaseRecord,
  useOne,
  useCreate,
  useDelete,
} from "@refinedev/core";
import {
  Box,
  CircularProgress,
  Typography,
  Button,
  IconButton,
  Snackbar,
  Alert,
  Fade,
} from "@mui/material";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import PersonIcon from "@mui/icons-material/Person";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import { BillsOverview } from "./BillsOverview";
import { PersonalOverview } from "./PersonalOverview";
import { YearlyOverview } from "./YearlyOverview";
import { CashFlowOverview } from "./CashFlowOverview";
import { SurplusTargetPill } from "./SurplusTargetPill";
import { SHORT_MONTHS } from "../../lib/constants";
import { useRouter } from "next/navigation";
import {
  getPayPeriodsForMonth,
  balancePayWeeks,
  getBillOccurrencesInView,
  assertNoUnderfundedBills,
  monthKeyOf,
  BillSplitRecord,
} from "../../lib/pay-period-utils";

// How far forward the Optimize action plans. 36 months = 3 years, which
// keeps every month the user can realistically scroll to funded with proper
// BillSplit rows. Extending further inflates the first-run write cost
// without much planning value for a personal-finances tool.
const OPTIMIZE_HORIZON_MONTHS = 36;

export function OverviewPage() {
  const router = useRouter();
  const today = new Date();

  // ── View state ──
  // viewYear/viewMonth drive the month picker at the top of the cash-flow
  // section. They only affect what we RENDER; the Optimize action always
  // recomputes the full next-36-months window starting from `today`.
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [isOptimizing, setIsOptimizing] = useState(false);

  // Stale-data alert banner. Persisted to localStorage so it survives page
  // navigation and app restarts — the user should keep seeing "please
  // Optimize" until they actually click the button. Cleared inside
  // handleOptimize().
  const [optimizeAlert, setOptimizeAlert] = useState<string | null>(() => {
    try { return localStorage.getItem("overviewOptimizeAlert"); } catch { return null; }
  });
  const [successToast, setSuccessToast] = useState(false);

  // Refs used by the change-detection effect below. We stash the previous
  // signatures of bills/incomes/personals/surplusTarget so we can compare
  // against the current values on each data update and fire the alert only
  // when something actually changed post-mount.
  const initializedRef = useRef(false);
  const prevBillsSigRef = useRef("");
  const prevIncomesSigRef = useRef("");
  const prevPersonalsSigRef = useRef("");
  const prevSurplusTargetRef = useRef(0);

  // Mirror the alert state to localStorage so it persists across navigations
  // and app restarts (see comment on optimizeAlert declaration above).
  useEffect(() => {
    try {
      if (optimizeAlert) localStorage.setItem("overviewOptimizeAlert", optimizeAlert);
      else localStorage.removeItem("overviewOptimizeAlert");
    } catch {}
  }, [optimizeAlert]);

  // ── Data queries ──
  // `successNotification: false, errorNotification: false` is required
  // because Plan/Settings pages also mount some of these resources
  // simultaneously — duplicate Refine notification keys cause React key
  // warnings otherwise. See CLAUDE.md → "Refine notifications".
  const { query: billsQuery } = useList<BaseRecord>({ resource: "Bill", successNotification: false, errorNotification: false });
  const { query: personalQuery } = useList<BaseRecord>({ resource: "Personal", successNotification: false, errorNotification: false });
  const { query: yearlyQuery } = useList<BaseRecord>({ resource: "YearlyCost", successNotification: false, errorNotification: false });
  const { query: settingsQuery } = useOne<BaseRecord>({
    resource: "AppSettings",
    id: "global",
    successNotification: false,
    errorNotification: false,
  });
  const { query: incomesQuery } = useList<BaseRecord>({
    resource: "Income",
    pagination: { mode: "off" },
    successNotification: false,
    errorNotification: false,
  });
  const { query: splitsQuery } = useList<BaseRecord>({
    resource: "BillSplit",
    pagination: { mode: "off" },
    successNotification: false,
    errorNotification: false,
  });
  const { mutateAsync: createSplit } = useCreate();
  const { mutateAsync: deleteSplit } = useDelete();

  // ── All hooks must run in the same order every render. Pull data out of the
  // query results (defaulting while loading) BEFORE any conditional return so
  // every useMemo/useEffect below sits above the loading + no-income guards.
  const bills = (billsQuery.data?.data || []) as any[];
  const personalBills = (personalQuery.data?.data || []) as any[];
  const yearlyCosts = (yearlyQuery.data?.data || []) as any[];
  const settings = (settingsQuery.data?.data || {}) as any;
  const incomes = (incomesQuery.data?.data || []) as any[];
  const primaryIncome = incomes.find((i) => i.isPrimary) as any | undefined;
  const splitRowsRaw = (splitsQuery.data?.data as any[]) || [];

  // Normalize BillSplit rows to the strict-typed shape used downstream by
  // the dashboard components and the balance algorithm. Prisma returns
  // Decimal/BigInt-ish values through Refine — coerce everything to
  // string/number here so consumers don't have to defensively re-cast.
  const splits: BillSplitRecord[] = useMemo(() => {
    return splitRowsRaw.map((r) => ({
      billId: String(r.billId),
      monthKey: String(r.monthKey),
      weekIndex: Number(r.weekIndex),
      amountCents: Number(r.amountCents),
      occurrenceCoord: Number(r.occurrenceCoord ?? 0),
    }));
  }, [splitRowsRaw]);

  // Minimum weekly surplus target (cents). Default $300 if unset.
  // DB column is `wifeWeeklyTargetCents` for backward compat with earlier
  // installs — the field is user-facing as "Surplus Target".
  const targetSurplusCents = Number(settings?.wifeWeeklyTargetCents ?? 30000);

  // ── Top-of-page summary totals ──
  // High-overview trio at the very top: how much money the user is committed
  // to across each cost bucket. Kept simple:
  //   - Bills:    monthly obligation = sum of raw bill amounts.
  //   - Personal: monthly obligation = one-shot amounts + repeatWeekly items
  //     scaled by the CURRENT view's pay-week count (matches PersonalOverview's
  //     header total so the top-of-page number and the section header agree).
  //   - Yearly:   raw annual total = sum of YearlyCost amounts. Left in yearly
  //     units so the label ("YEAR") tells the user this is annual, not monthly.
  const currentViewPayWeekCount = useMemo(() => {
    if (!primaryIncome) return 4;
    const payWeekday = Number(primaryIncome.payDay);
    const biWeekly = primaryIncome.paymentCycle === "BI_WEEKLY";
    return getPayPeriodsForMonth(viewYear, viewMonth, payWeekday, today, biWeekly).length;
  }, [primaryIncome, viewYear, viewMonth]);
  const summaryBillsMonthly = useMemo(
    () => bills.reduce((acc: number, b: any) => acc + (Number(b.amount) || 0), 0),
    [bills],
  );
  const summaryPersonalMonthly = useMemo(
    () =>
      personalBills.reduce((acc: number, p: any) => {
        const amount = Number(p.amount) || 0;
        // repeatWeekly personals (Gas, Spending) fire every pay week — scale
        // to a monthly figure using the current view's period count.
        if (p.repeatWeekly) return acc + amount * currentViewPayWeekCount;
        return acc + amount;
      }, 0),
    [personalBills, currentViewPayWeekCount],
  );
  const summaryYearlyTotal = useMemo(
    () => yearlyCosts.reduce((acc: number, y: any) => acc + (Number(y.amount) || 0), 0),
    [yearlyCosts],
  );

  // Detect legacy BillSplit rows (occurrenceCoord=0) — these were written by
  // the pre-multi-occurrence algorithm and need to be re-optimized so
  // per-occurrence allocations land correctly. Missing this migration causes
  // "phantom" double-loading in P1 (natural fallback for the in-month
  // occurrence stacks on top of the legacy split for the next-month one).
  const hasLegacySplits = useMemo(
    () => splitRowsRaw.length > 0 && splitRowsRaw.every((r: any) => Number(r.occurrenceCoord ?? 0) === 0),
    [splitRowsRaw],
  );

  // ── Change detection → stale-data alert ──
  // Watches bills/incomes/personals/surplusTarget and fires the alert whenever
  // any of them change AFTER the initial mount. On first mount it snapshots
  // the current values without firing (so a fresh page load doesn't flash
  // the alert). Legacy `occurrenceCoord=0` splits also trigger the alert
  // on first mount as a one-time migration signal.
  useEffect(() => {
    const loading =
      billsQuery.isLoading || personalQuery.isLoading ||
      settingsQuery.isLoading || incomesQuery.isLoading || splitsQuery.isLoading;
    if (loading) return;

    const billsSig = bills.map((b: any) => `${b.id}:${b.amount}:${b.dueDate}`).sort().join(",");
    const incomesSig = incomes.map((i: any) => `${i.id}:${i.amount}:${i.payDay}:${i.paymentCycle}`).sort().join(",");
    const personalsSig = personalBills.map((p: any) => `${p.id}:${p.amount}:${p.dueDate}`).sort().join(",");
    const surplusTarget = targetSurplusCents;

    if (!initializedRef.current) {
      prevBillsSigRef.current = billsSig;
      prevIncomesSigRef.current = incomesSig;
      prevPersonalsSigRef.current = personalsSig;
      prevSurplusTargetRef.current = surplusTarget;
      initializedRef.current = true;
      if (hasLegacySplits) {
        setOptimizeAlert(
          "Bill schedule needs re-optimization — the multi-occurrence fix requires re-running Optimize so each pay week gets the correct allocation.",
        );
      }
      return;
    }

    if (billsSig !== prevBillsSigRef.current) {
      prevBillsSigRef.current = billsSig;
      setOptimizeAlert("Bills were added or updated.");
    } else if (incomesSig !== prevIncomesSigRef.current) {
      prevIncomesSigRef.current = incomesSig;
      setOptimizeAlert("Income was added or updated.");
    } else if (personalsSig !== prevPersonalsSigRef.current) {
      prevPersonalsSigRef.current = personalsSig;
      setOptimizeAlert("Personal expenses were added or updated.");
    } else if (surplusTarget !== prevSurplusTargetRef.current) {
      prevSurplusTargetRef.current = surplusTarget;
      setOptimizeAlert("Weekly surplus target was changed.");
    }
  }, [bills, incomes, personalBills, targetSurplusCents, hasLegacySplits, billsQuery.isLoading, personalQuery.isLoading, settingsQuery.isLoading, incomesQuery.isLoading, splitsQuery.isLoading]);

  // ── Optimize action ──
  // Iterates the next 36 months (3 years). For each month:
  //   1. Builds the pay-period grid.
  //   2. Computes per-period income + fixed personal expenses.
  //   3. Preserves splits in already-elapsed ("locked") pay weeks as history.
  //   4. Calls balancePayWeeks to allocate the remaining bill amounts.
  //   5. Verifies no bill occurrence was under-funded (fail loud).
  //   6. Diffs old vs new allocations and rewrites only what changed.
  // Locked-week preservation is critical — see the big comment on
  // lockedAllocations below.
  const handleOptimize = async () => {
    if (isOptimizing || !primaryIncome) return;
    setIsOptimizing(true);
    try {
      const payWeekday = Number(primaryIncome.payDay);
      const biWeekly = primaryIncome.paymentCycle === "BI_WEEKLY";

      // Sums cents of income landing in each pay period. Iterates every
      // day of the target month, groups paydays by income source (each
      // income may have its own payDay/cycle/offset for households with
      // asymmetric paychecks), and buckets each payday into the period
      // whose [startDay, endDay] contains it.
      const computeIncomePerPeriod = (periods: ReturnType<typeof getPayPeriodsForMonth>, tYear: number, tMonth: number) => {
        const dim = new Date(tYear, tMonth + 1, 0).getDate();
        const collectPaydays = (payDay: number, isBiWeekly: boolean, offset: number) => {
          const all: number[] = [];
          for (let d = 1; d <= dim; d++) {
            if (new Date(tYear, tMonth, d).getDay() === payDay) all.push(d);
          }
          return isBiWeekly ? all.filter((_, i) => i % 2 === offset) : all;
        };
        return periods.map((p) => {
          let total = 0;
          incomes.forEach((income: any) => {
            const pd = Number(income.payDay ?? payWeekday);
            const isBW = (income.paymentCycle ?? primaryIncome.paymentCycle) === "BI_WEEKLY";
            const off = Number(income.payWeekOffset ?? 0);
            if (collectPaydays(pd, isBW, off).some((d) => d >= p.startDay && d <= p.endDay)) {
              total += Math.round((Number(income.amount) || 0) * 100);
            }
          });
          return total;
        });
      };

      // Sums cents of "fixed personal expenses" landing in each pay period.
      // Personal items come in three flavors:
      //   - repeatWeekly     → fires every pay period
      //   - weekOfMonth set  → fires only in that specific pay period (P1..P4)
      //   - dueDate set      → fires in the period covering its calendar day,
      //                        with forward-extension into the next month
      //                        (same rule getBillPeriodKey uses for bills).
      const computePersonalPerPeriod = (periods: ReturnType<typeof getPayPeriodsForMonth>) =>
        periods.map((p) => {
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

      // Main loop: OPTIMIZE_HORIZON_MONTHS forward from today. Each iteration
      // is independent — one month's optimization never reads from another.
      for (let i = 0; i < OPTIMIZE_HORIZON_MONTHS; i++) {
        const target = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const tYear = target.getFullYear();
        const tMonth = target.getMonth();
        const mk = monthKeyOf(tYear, tMonth);

        const periods = getPayPeriodsForMonth(tYear, tMonth, payWeekday, today, biWeekly);
        if (periods.length === 0) continue;

        // Only the current month has a today coord; future months treat
        // every period as unlocked (nothing has been "paid" yet).
        const isThisCurrentMonth = tYear === today.getFullYear() && tMonth === today.getMonth();
        const tTodayCoord = isThisCurrentMonth ? today.getDate() : 0;

        // A period is "locked" once today has passed its endDay — the
        // paycheck for that week has already been received and spent, so
        // we must not rewrite its allocations. See the lockedAllocations
        // block below for the full rationale.
        const lockedWeekIndices = new Set<number>(
          periods.filter((p) => tTodayCoord > 0 && p.endDay <= tTodayCoord).map((p) => p.index),
        );

        const existingForMonth = splitRowsRaw.filter((o: any) => String(o.monthKey) === mk);

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
          incomePerPeriodCents: computeIncomePerPeriod(periods, tYear, tMonth),
          fixedExpensesPerPeriodCents: computePersonalPerPeriod(periods),
          targetSurplusCents,
          todayCoord: tTodayCoord,
          lockedAllocations,
        });

        // Fail loud if the algorithm silently dropped funding for any bill
        // occurrence — this is the guard that prevents "Phone Bill missing
        // from Sep P1" bugs from ever reappearing without a scream.
        assertNoUnderfundedBills(result, `Optimize Now — ${mk}`);

        // Only unlocked rows are recomputed; locked-week rows are preserved
        // as-is (they represent past-paycheck commitments).
        const toDelete = existingForMonth.filter(
          (o: any) => !lockedWeekIndices.has(Number(o.weekIndex)),
        );

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
        if (currentSig === newSig) continue;

        // Delete-then-create is intentional: there's no `upsert` for a
        // composite key that includes occurrenceCoord, and the algorithm
        // may add/remove splits (not just change amounts). Locked-week
        // rows are excluded from `toDelete` so they survive.
        for (const o of toDelete) {
          await deleteSplit({ resource: "BillSplit", id: o.id, successNotification: false });
        }
        for (const a of result.allocations) {
          await createSplit({
            resource: "BillSplit",
            values: {
              billId: a.billId,
              monthKey: mk,
              weekIndex: a.weekIndex,
              amountCents: a.amountCents,
              occurrenceCoord: a.occurrenceCoord,
            },
            successNotification: false,
          });
        }
      }
    } finally {
      setIsOptimizing(false);
      setOptimizeAlert(null);
      setSuccessToast(true);
    }
  };

  // ── Loading gate ──
  // Must come AFTER every hook above so React's hooks-order rule stays
  // satisfied across the loading → loaded transition. Same reason the
  // no-income guard below sits after this one.
  if (
    billsQuery.isLoading ||
    personalQuery.isLoading ||
    yearlyQuery.isLoading ||
    settingsQuery.isLoading ||
    incomesQuery.isLoading ||
    splitsQuery.isLoading
  ) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}>
        <CircularProgress size={60} thickness={4} />
      </Box>
    );
  }

  // Month picker handlers — wrap year boundary in both directions.
  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  // ── Empty state ──
  // If the user hasn't added a primary income source we can't compute pay
  // periods at all, so show a friendly CTA to Settings instead of a broken
  // dashboard. Yearly overview still renders — it doesn't depend on income.
  if (!primaryIncome) {
    return (
      <Box sx={{ p: 4, display: "flex", flexDirection: "column", gap: 4 }}>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            py: 10,
            gap: 3,
            border: "1px dashed rgba(255,255,255,0.1)",
            borderRadius: 4,
          }}
        >
          <Box
            sx={{
              p: 2,
              borderRadius: 3,
              bgcolor: "rgba(129,140,248,0.1)",
              border: "1px solid rgba(129,140,248,0.2)",
            }}
          >
            <AccountBalanceWalletIcon sx={{ fontSize: "2.5rem", color: "primary.light" }} />
          </Box>
          <Box sx={{ textAlign: "center" }}>
            <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>
              No Income Added Yet
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 380 }}>
              Add a primary income source in Settings so the Overview can show your cash flow, bill schedule, and allowance.
            </Typography>
          </Box>
          <Button
            variant="contained"
            disableElevation
            onClick={() => router.push("/Settings")}
            sx={{ fontWeight: 800, borderRadius: 2, px: 4 }}
          >
            Go to Settings
          </Button>
        </Box>
        <YearlyOverview yearlyCosts={yearlyCosts} months={SHORT_MONTHS} />
      </Box>
    );
  }

  // Merge the primary income's pay cadence into `settings` so downstream
  // components (BillsOverview, CashFlowOverview, PersonalOverview) can
  // treat pay cycle as a settings prop even though it actually lives on
  // the Income record now. Legacy: paymentCycle/payDay/w2Amount used to
  // live on AppSettings; these props preserve that surface.
  const effectiveSettings = {
    ...settings,
    paymentCycle: primaryIncome.paymentCycle,
    payDay: primaryIncome.payDay,
    w2Amount: primaryIncome.amount,
  };

  return (
    <Box sx={{ p: 4, display: "flex", flexDirection: "column", gap: 6 }}>

      {/* ── Page title ── */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <Box
          sx={{
            display: "flex",
            p: 1,
            borderRadius: 2,
            bgcolor: "primary.main",
            boxShadow: "0 0 20px rgba(129, 140, 248, 0.4)",
          }}
        >
          <AccountBalanceWalletIcon sx={{ color: "white", fontSize: "1.8rem" }} />
        </Box>
        <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: "-1px", color: "white" }}>
          Cash Flow &amp; Allowance
        </Typography>
      </Box>

      {/* ── High-overview totals ──
          Three tiles: monthly Bills, monthly Personal, yearly YearlyCost totals.
          Purely informational — at-a-glance "how much am I committing to?"
          reference points that stay visible while scrolling through the more
          detailed sections below. */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
          gap: 2,
        }}
      >
        {[
          {
            label: "Bills",
            amount: summaryBillsMonthly,
            unit: "/ month",
            icon: <ReceiptLongIcon sx={{ fontSize: 20, color: "white" }} />,
            accent: "#f43f5e",
          },
          {
            label: "Personal",
            amount: summaryPersonalMonthly,
            unit: "/ month",
            icon: <PersonIcon sx={{ fontSize: 20, color: "white" }} />,
            accent: "#818cf8",
          },
          {
            label: "Yearly Costs",
            amount: summaryYearlyTotal,
            unit: "/ year",
            icon: <CalendarMonthIcon sx={{ fontSize: 20, color: "white" }} />,
            accent: "#3DBC83",
          },
        ].map((tile) => (
          <Box
            key={tile.label}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              px: 2.5,
              py: 2,
              borderRadius: 3,
              bgcolor: "rgba(30, 41, 59, 0.55)",
              border: `1px solid ${tile.accent}26`,
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 40,
                height: 40,
                borderRadius: 2,
                bgcolor: tile.accent,
                boxShadow: `0 0 15px ${tile.accent}55`,
                flexShrink: 0,
              }}
            >
              {tile.icon}
            </Box>
            <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  fontWeight: 800,
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                  fontSize: "0.68rem",
                  lineHeight: 1.2,
                }}
              >
                {tile.label}
              </Typography>
              <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.75 }}>
                <Typography
                  variant="h5"
                  sx={{
                    fontWeight: 900,
                    color: "white",
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1.2,
                  }}
                >
                  ${tile.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ color: "text.disabled", fontWeight: 600, fontSize: "0.7rem" }}
                >
                  {tile.unit}
                </Typography>
              </Box>
            </Box>
          </Box>
        ))}
      </Box>

      {/* ── Stale-data alert ── */}
      {optimizeAlert && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            px: 2.5,
            py: 1.75,
            borderRadius: 3,
            bgcolor: "rgba(251, 191, 36, 0.07)",
            border: "1px solid rgba(251, 191, 36, 0.35)",
          }}
        >
          <WarningAmberIcon sx={{ color: "#fbbf24", fontSize: 22, flexShrink: 0 }} />
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ color: "white", fontWeight: 700, fontSize: "0.9rem", lineHeight: 1.3 }}>
              {optimizeAlert}
            </Typography>
            <Typography sx={{ color: "text.secondary", fontSize: "0.78rem", mt: 0.25 }}>
              Re-optimize your pay week schedule to reflect the latest changes.
            </Typography>
          </Box>
          <Button
            variant="contained"
            size="small"
            disableElevation
            disabled={isOptimizing}
            onClick={() => handleOptimize()}
            startIcon={
              isOptimizing
                ? <CircularProgress size={12} color="inherit" />
                : <AutoFixHighIcon sx={{ fontSize: 14 }} />
            }
            sx={{ fontWeight: 800, borderRadius: 2, flexShrink: 0, fontSize: "0.8rem" }}
          >
            {isOptimizing ? "Optimizing…" : "Optimize Now"}
          </Button>
        </Box>
      )}

      {/* ── Monthly cash flow section ── */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          p: 3,
          borderRadius: 4,
          border: "1px solid rgba(129, 140, 248, 0.12)",
          bgcolor: "rgba(30, 41, 59, 0.6)",
        }}
      >
        {/* Surplus target + month picker */}
        <Box sx={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 1.5 }}>
          <Button
            variant="outlined"
            size="small"
            disableElevation
            disabled={isOptimizing}
            onClick={() => handleOptimize()}
            startIcon={
              isOptimizing
                ? <CircularProgress size={12} color="inherit" />
                : <AutoFixHighIcon sx={{ fontSize: 14 }} />
            }
            sx={{
              fontWeight: 800,
              borderRadius: 2,
              fontSize: "0.75rem",
              borderColor: "rgba(129, 140, 248, 0.35)",
              color: "primary.light",
              "&:hover": {
                borderColor: "primary.light",
                bgcolor: "rgba(129, 140, 248, 0.08)",
              },
            }}
          >
            {isOptimizing ? "Optimizing…" : "Optimize"}
          </Button>
          <SurplusTargetPill />
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 1,
              py: 0.5,
              borderRadius: 2,
              bgcolor: "rgba(15, 23, 42, 0.5)",
              border: "1px solid rgba(129, 140, 248, 0.15)",
            }}
          >
            <IconButton
              onClick={prevMonth}
              sx={{ color: "primary.light", "&:hover": { bgcolor: "rgba(129, 140, 248, 0.18)" } }}
            >
              <NavigateBeforeIcon sx={{ fontSize: 28 }} />
            </IconButton>
            <Box sx={{ minWidth: 140, textAlign: "center" }}>
              <Typography
                sx={{
                  fontWeight: 800,
                  color: "white",
                  fontSize: "0.95rem",
                  letterSpacing: 0.3,
                  lineHeight: 1.2,
                }}
              >
                {monthLabel}
              </Typography>
              {viewYear === today.getFullYear() && viewMonth === today.getMonth() && (
                <Typography
                  sx={{
                    fontSize: "0.6rem",
                    fontWeight: 900,
                    letterSpacing: "1px",
                    textTransform: "uppercase",
                    color: "primary.light",
                    mt: 0.3,
                  }}
                >
                  Current Month
                </Typography>
              )}
            </Box>
            <IconButton
              onClick={nextMonth}
              sx={{ color: "primary.light", "&:hover": { bgcolor: "rgba(129, 140, 248, 0.18)" } }}
            >
              <NavigateNextIcon sx={{ fontSize: 28 }} />
            </IconButton>
          </Box>
        </Box>

        <CashFlowOverview
          settings={effectiveSettings}
          bills={bills}
          personalBills={personalBills}
          incomes={incomes}
          viewYear={viewYear}
          viewMonth={viewMonth}
          splits={splits}
        />
        <BillsOverview
          bills={bills}
          settings={effectiveSettings}
          viewYear={viewYear}
          viewMonth={viewMonth}
          splits={splits}
        />
        <PersonalOverview
          personalBills={personalBills}
          bills={bills}
          incomes={incomes}
          settings={effectiveSettings}
          viewYear={viewYear}
          viewMonth={viewMonth}
          splits={splits}
        />
      </Box>

      {/* ── Yearly overview section ── */}
      <Box
        sx={{
          p: 3,
          borderRadius: 4,
          border: "1px solid rgba(129, 140, 248, 0.12)",
          bgcolor: "rgba(30, 41, 59, 0.6)",
        }}
      >
        <YearlyOverview yearlyCosts={yearlyCosts} months={SHORT_MONTHS} />
      </Box>

      <Snackbar
        open={successToast}
        autoHideDuration={3000}
        onClose={() => setSuccessToast(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        slots={{ transition: Fade }}
      >
        <Alert severity="success" variant="filled" onClose={() => setSuccessToast(false)}>
          Pay weeks optimized across the next 36 months!
        </Alert>
      </Snackbar>

    </Box>
  );
}
