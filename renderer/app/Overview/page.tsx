"use client";

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
import { BillsOverview } from "../../components/dashboard/BillsOverview";
import { PersonalOverview } from "../../components/dashboard/PersonalOverview";
import { YearlyOverview } from "../../components/dashboard/YearlyOverview";
import { CashFlowOverview } from "../../components/dashboard/CashFlowOverview";
import { WifeTargetPill } from "../../components/dashboard/WifeTargetPill";
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

export default function Overview() {
  const router = useRouter();
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizeAlert, setOptimizeAlert] = useState<string | null>(() => {
    try { return localStorage.getItem("overviewOptimizeAlert"); } catch { return null; }
  });
  const [successToast, setSuccessToast] = useState(false);

  const initializedRef = useRef(false);
  const prevBillsSigRef = useRef("");
  const prevIncomesSigRef = useRef("");
  const prevPersonalsSigRef = useRef("");
  const prevWifeTargetRef = useRef(0);

  useEffect(() => {
    try {
      if (optimizeAlert) localStorage.setItem("overviewOptimizeAlert", optimizeAlert);
      else localStorage.removeItem("overviewOptimizeAlert");
    } catch {}
  }, [optimizeAlert]);

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

  const splits: BillSplitRecord[] = useMemo(() => {
    return splitRowsRaw.map((r) => ({
      billId: String(r.billId),
      monthKey: String(r.monthKey),
      weekIndex: Number(r.weekIndex),
      amountCents: Number(r.amountCents),
      occurrenceCoord: Number(r.occurrenceCoord ?? 0),
    }));
  }, [splitRowsRaw]);

  const targetSurplusCents = Number(settings?.wifeWeeklyTargetCents ?? 30000);

  // Detect legacy BillSplit rows (occurrenceCoord=0) — these were written by
  // the pre-multi-occurrence algorithm and need to be re-optimized so
  // per-occurrence allocations land correctly. Missing this migration causes
  // "phantom" double-loading in P1 (natural fallback for the in-month
  // occurrence stacks on top of the legacy split for the next-month one).
  const hasLegacySplits = useMemo(
    () => splitRowsRaw.length > 0 && splitRowsRaw.every((r: any) => Number(r.occurrenceCoord ?? 0) === 0),
    [splitRowsRaw],
  );

  // Detect post-load changes and prompt the user to re-optimize.
  useEffect(() => {
    const loading =
      billsQuery.isLoading || personalQuery.isLoading ||
      settingsQuery.isLoading || incomesQuery.isLoading || splitsQuery.isLoading;
    if (loading) return;

    const billsSig = bills.map((b: any) => `${b.id}:${b.amount}:${b.dueDate}`).sort().join(",");
    const incomesSig = incomes.map((i: any) => `${i.id}:${i.amount}:${i.payDay}:${i.paymentCycle}`).sort().join(",");
    const personalsSig = personalBills.map((p: any) => `${p.id}:${p.amount}:${p.dueDate}`).sort().join(",");
    const wifeTarget = targetSurplusCents;

    if (!initializedRef.current) {
      prevBillsSigRef.current = billsSig;
      prevIncomesSigRef.current = incomesSig;
      prevPersonalsSigRef.current = personalsSig;
      prevWifeTargetRef.current = wifeTarget;
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
    } else if (wifeTarget !== prevWifeTargetRef.current) {
      prevWifeTargetRef.current = wifeTarget;
      setOptimizeAlert("Wife's weekly target was changed.");
    }
  }, [bills, incomes, personalBills, targetSurplusCents, hasLegacySplits, billsQuery.isLoading, personalQuery.isLoading, settingsQuery.isLoading, incomesQuery.isLoading, splitsQuery.isLoading]);

  const handleOptimize = async () => {
    if (isOptimizing || !primaryIncome) return;
    setIsOptimizing(true);
    try {
      const payWeekday = Number(primaryIncome.payDay);
      const biWeekly = primaryIncome.paymentCycle === "BI_WEEKLY";

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

      for (let i = 0; i < 12; i++) {
        const target = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const tYear = target.getFullYear();
        const tMonth = target.getMonth();
        const mk = monthKeyOf(tYear, tMonth);

        const periods = getPayPeriodsForMonth(tYear, tMonth, payWeekday, today, biWeekly);
        if (periods.length === 0) continue;

        const isThisCurrentMonth = tYear === today.getFullYear() && tMonth === today.getMonth();
        const tTodayCoord = isThisCurrentMonth ? today.getDate() : 0;

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
        const currentSig = toDelete
          .map((o: any) => `${o.billId}:${o.weekIndex}:${o.occurrenceCoord ?? 0}:${o.amountCents}`)
          .sort()
          .join(",");
        const newSig = result.allocations
          .map((a) => `${a.billId}:${a.weekIndex}:${a.occurrenceCoord}:${a.amountCents}`)
          .sort()
          .join(",");
        if (currentSig === newSig) continue;

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
        {/* Wife target + month picker */}
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
          <WifeTargetPill />
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
          Pay weeks optimized across the next 12 months!
        </Alert>
      </Snackbar>

    </Box>
  );
}
