"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
} from "@mui/material";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { BillsOverview } from "../../components/dashboard/BillsOverview";
import { PersonalOverview } from "../../components/dashboard/PersonalOverview";
import { YearlyOverview } from "../../components/dashboard/YearlyOverview";
import { CashFlowOverview } from "../../components/dashboard/CashFlowOverview";
import { WifeTargetPill } from "../../components/dashboard/WifeTargetPill";
import { SHORT_MONTHS } from "../../lib/constants";
import { useRouter } from "next/navigation";
import {
  getPayPeriodsForMonth,
  balanceBillsGreedy,
  monthKeyOf,
  BillOverrideRecord,
} from "../../lib/pay-period-utils";

export default function Overview() {
  const router = useRouter();
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  // Tracks the input-hash of the last balance run per month, so re-renders
  // triggered by the override write don't cause the effect to re-fire.
  const balancedHashRef = useRef<Map<string, string>>(new Map());
  const balancingRef = useRef(false);

  const { query: billsQuery } = useList<BaseRecord>({ resource: "Bill" });
  const { query: personalQuery } = useList<BaseRecord>({ resource: "Personal" });
  const { query: yearlyQuery } = useList<BaseRecord>({ resource: "YearlyCost" });
  const { query: settingsQuery } = useOne<BaseRecord>({
    resource: "AppSettings",
    id: "global",
  });
  const { query: incomesQuery } = useList<BaseRecord>({
    resource: "Income",
    pagination: { mode: "off" },
  });
  const { query: overridesQuery } = useList<BaseRecord>({
    resource: "BillPayWeekOverride",
    pagination: { mode: "off" },
  });
  const { mutateAsync: createOverride } = useCreate();
  const { mutateAsync: deleteOverride } = useDelete();

  // ── All hooks must run in the same order every render. Pull data out of the
  // query results (defaulting while loading) BEFORE any conditional return so
  // every useMemo/useEffect below sits above the loading + no-income guards.
  const bills = (billsQuery.data?.data || []) as any[];
  const personalBills = (personalQuery.data?.data || []) as any[];
  const yearlyCosts = (yearlyQuery.data?.data || []) as any[];
  const settings = (settingsQuery.data?.data || {}) as any;
  const incomes = (incomesQuery.data?.data || []) as any[];
  const primaryIncome = incomes.find((i) => i.isPrimary) as any | undefined;
  const overrideRowsRaw = (overridesQuery.data?.data as any[]) || [];

  const monthKey = useMemo(
    () => monthKeyOf(viewYear, viewMonth),
    [viewYear, viewMonth],
  );
  const overrides: BillOverrideRecord[] = useMemo(() => {
    return overrideRowsRaw.map((r) => ({
      billId: String(r.billId),
      monthKey: String(r.monthKey),
      weekIndex: Number(r.weekIndex),
    }));
  }, [overrideRowsRaw]);

  const targetSurplusCents = Number(settings?.wifeWeeklyTargetCents ?? 30000);

  const balanceInputHash = useMemo(() => {
    return JSON.stringify({
      monthKey,
      target: targetSurplusCents,
      cycle: primaryIncome?.paymentCycle,
      payDay: primaryIncome?.payDay,
      bills: bills
        .map((b: any) => `${b.id}:${b.amount}:${b.dueDate}`)
        .sort(),
      personals: personalBills
        .map(
          (p: any) =>
            `${p.id}:${p.amount}:${p.dueDate}:${p.weekOfMonth ?? ""}:${
              p.repeatWeekly ? 1 : 0
            }`,
        )
        .sort(),
      incomes: incomes
        .map(
          (i: any) =>
            `${i.id}:${i.amount}:${i.payDay}:${i.paymentCycle}:${i.payWeekOffset ?? 0}`,
        )
        .sort(),
    });
  }, [
    monthKey,
    targetSurplusCents,
    primaryIncome?.paymentCycle,
    primaryIncome?.payDay,
    bills,
    personalBills,
    incomes,
  ]);

  useEffect(() => {
    if (balancingRef.current) return;
    if (!primaryIncome) return;
    if (bills.length === 0) return;
    // Every input query MUST have finished loading before we plan overrides —
    // otherwise `overrideRowsRaw` might still be `[]` (query loading) and the
    // "same as DB?" comparison thinks the DB is empty, causing us to skip
    // deletes and create-on-top-of existing rows → P2002 unique-constraint 500.
    if (
      billsQuery.isLoading ||
      personalQuery.isLoading ||
      settingsQuery.isLoading ||
      incomesQuery.isLoading ||
      overridesQuery.isLoading
    ) {
      return;
    }
    if (balancedHashRef.current.get(monthKey) === balanceInputHash) return;

    const run = async () => {
      balancingRef.current = true;
      try {
        const payWeekday = Number(primaryIncome.payDay);
        const biWeekly = primaryIncome.paymentCycle === "BI_WEEKLY";
        const periods = getPayPeriodsForMonth(
          viewYear,
          viewMonth,
          payWeekday,
          new Date(),
          biWeekly,
        );
        if (periods.length === 0) return;
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

        const collectPaydays = (
          payDay: number,
          isBiWeekly: boolean,
          offset: number,
        ): number[] => {
          const all: number[] = [];
          for (let d = 1; d <= daysInMonth; d++) {
            if (new Date(viewYear, viewMonth, d).getDay() === payDay) all.push(d);
          }
          return isBiWeekly ? all.filter((_, i) => i % 2 === offset) : all;
        };

        const incomePerPeriodCents = periods.map((p) => {
          let total = 0;
          incomes.forEach((income: any) => {
            const incomePayDay = Number(income.payDay ?? payWeekday);
            const isBW =
              (income.paymentCycle ?? primaryIncome.paymentCycle) ===
              "BI_WEEKLY";
            const offset = Number(income.payWeekOffset ?? 0);
            const paydays = collectPaydays(incomePayDay, isBW, offset);
            if (paydays.some((d) => d >= p.startDay && d <= p.endDay)) {
              total += Math.round((Number(income.amount) || 0) * 100);
            }
          });
          return total;
        });

        const personalPerPeriodCents = periods.map((p) => {
          let total = 0;
          personalBills.forEach((pb: any) => {
            let fires = false;
            if (pb.repeatWeekly) fires = true;
            else if (pb.weekOfMonth != null)
              fires = `P${pb.weekOfMonth}` === p.key;
            else {
              const D = Number(pb.dueDate);
              const nextCoord = D + p.daysInMonth;
              fires =
                (D >= p.startDay && D <= p.endDay) ||
                (nextCoord >= p.startDay && nextCoord <= p.endDay);
            }
            if (fires) total += Math.round((Number(pb.amount) || 0) * 100);
          });
          return total;
        });

        const result = balanceBillsGreedy({
          bills: bills.map((b) => ({
            id: b.id,
            amount: Number(b.amount),
            dueDate: Number(b.dueDate),
          })),
          periods,
          incomePerPeriodCents,
          fixedExpensesPerPeriodCents: personalPerPeriodCents,
          targetSurplusCents,
        });

        const currentForMonth = overrideRowsRaw
          .filter((o: any) => String(o.monthKey) === monthKey)
          .map((o: any) => `${o.billId}:${Number(o.weekIndex)}`)
          .sort();
        const nextForMonth = result.assignments
          .map((a) => `${a.billId}:${a.weekIndex}`)
          .sort();
        const same =
          currentForMonth.length === nextForMonth.length &&
          currentForMonth.every((s, i) => s === nextForMonth[i]);

        if (!same) {
          const existing = overrideRowsRaw.filter(
            (o: any) => String(o.monthKey) === monthKey,
          );
          for (const o of existing) {
            await deleteOverride({
              resource: "BillPayWeekOverride",
              id: o.id,
              successNotification: false,
            });
          }
          for (const a of result.assignments) {
            await createOverride({
              resource: "BillPayWeekOverride",
              values: {
                billId: a.billId,
                monthKey,
                weekIndex: a.weekIndex,
              },
              successNotification: false,
            });
          }
        }

        balancedHashRef.current.set(monthKey, balanceInputHash);
      } finally {
        balancingRef.current = false;
      }
    };

    void run();
    // Hash captures all the real inputs; overrideRowsRaw and mutate fns are
    // intentionally omitted so we don't re-fire on our own writes. The
    // `isSuccess` flags are included so the effect re-fires once every input
    // query has finished loading (they only flip false→true, and never back,
    // so they don't cause churn later).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    balanceInputHash,
    monthKey,
    bills.length,
    !!primaryIncome,
    billsQuery.isSuccess,
    personalQuery.isSuccess,
    settingsQuery.isSuccess,
    incomesQuery.isSuccess,
    overridesQuery.isSuccess,
  ]);

  if (
    billsQuery.isLoading ||
    personalQuery.isLoading ||
    yearlyQuery.isLoading ||
    settingsQuery.isLoading ||
    incomesQuery.isLoading ||
    overridesQuery.isLoading
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
          overrides={overrides}
        />
        <BillsOverview
          bills={bills}
          settings={effectiveSettings}
          viewYear={viewYear}
          viewMonth={viewMonth}
          overrides={overrides}
        />
        <PersonalOverview
          personalBills={personalBills}
          bills={bills}
          incomes={incomes}
          settings={effectiveSettings}
          viewYear={viewYear}
          viewMonth={viewMonth}
          overrides={overrides}
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

    </Box>
  );
}
