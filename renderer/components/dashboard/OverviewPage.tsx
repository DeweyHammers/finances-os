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
  useUpdate,
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
  BillSplitRecord,
} from "../../lib/pay-period-utils";
// Optimize PHASE A (pure planning) + the horizon constant.
import { planOptimize, OPTIMIZE_HORIZON_MONTHS } from "../../lib/optimize-plan";

// Input signatures (bills / incomes / personals / surplus target) as of the
// last SUCCESSFUL Optimize, stored as JSON in `AppSettings.optimizedInputsSig`.
// The stale-data alert compares against this baseline instead of a per-mount
// snapshot, so an edit made on another page (e.g. changing a bill on /Bill,
// then opening Overview) still raises "please Optimize".
//
// It lives in the DATABASE, not localStorage: each window/origin (dev
// renderer, PROD app, a browser tab) has its own localStorage, so a baseline
// there went stale whenever Optimize ran from a different window and the
// alert kept nagging about changes that were already optimized.
interface InputSignatures {
  bills: string;
  incomes: string;
  personals: string;
  surplusTarget: number;
}

function parseOptimizedSig(raw: unknown): InputSignatures | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as InputSignatures;
  } catch {
    return null;
  }
}

// Alert texts raised by input-change detection. Only these are auto-cleared
// when the inputs match the baseline again — the legacy-split migration alert
// is cleared only by Optimize.
const INPUT_CHANGE_ALERTS = new Set([
  "Bills were added or updated.",
  "Income was added or updated.",
  "Personal expenses were added or updated.",
  "Weekly surplus target was changed.",
]);


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
  // Result toast. Message and open flag are split (see CLAUDE.md → "Toast
  // pattern") so the text doesn't collapse during the exit animation.
  // Severity lets the same Snackbar report failures — the old success-only
  // toast fired from a `finally` and claimed success even after a 500.
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [toastSeverity, setToastSeverity] = useState<"success" | "error">("success");
  const showToast = (msg: string, severity: "success" | "error") => {
    setToastMsg(msg);
    setToastSeverity(severity);
    setToastOpen(true);
  };

  // One-shot guard so the legacy-split migration alert only evaluates on the
  // first fully-loaded render.
  const initializedRef = useRef(false);

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
  const { mutateAsync: updateSettings } = useUpdate();
  // Guards the one-time "no baseline yet → adopt current inputs" DB write so
  // re-renders before the settings refetch lands don't fire it repeatedly.
  const baselineAdoptedRef = useRef(false);

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
  // Signatures of every Optimize input. Anything that changes the plan's
  // inputs must be reflected here, or edits to it won't raise the alert.
  const inputSigs: InputSignatures = useMemo(() => ({
    bills: bills.map((b: any) => `${b.id}:${b.amount}:${b.dueDate}:${b.neverSplit ? 1 : 0}`).sort().join(","),
    incomes: incomes.map((i: any) => `${i.id}:${i.amount}:${i.payDay}:${i.paymentCycle}:${i.payWeekOffset ?? 0}`).sort().join(","),
    personals: personalBills.map((p: any) => `${p.id}:${p.amount}:${p.dueDate}:${p.repeatWeekly ? 1 : 0}:${p.weekOfMonth ?? ""}`).sort().join(","),
    surplusTarget: targetSurplusCents,
  }), [bills, incomes, personalBills, targetSurplusCents]);

  // Persist the inputs as the new "last optimized" baseline. Shared by the
  // first-run adoption below and a successful Optimize.
  const saveOptimizedSig = (sig: InputSignatures) =>
    updateSettings({
      resource: "AppSettings",
      id: "global",
      values: { optimizedInputsSig: JSON.stringify(sig) },
      successNotification: false,
      errorNotification: false,
    });

  // Compares the current inputs against the baseline saved by the last
  // successful Optimize (`AppSettings.optimizedInputsSig`) and fires the
  // alert on any difference — whether the edit happened while Overview was
  // mounted or on another page before navigating here. The old version
  // snapshotted on mount, so "edit a bill on /Bill → open Overview" never
  // alerted (the snapshot already contained the new amount).
  //
  // When the inputs MATCH the baseline, a leftover input-change alert is
  // cleared — e.g. Optimize ran in another window, or an edit was reverted.
  //
  // First run with no baseline (fresh install / upgrade from the old
  // detector): adopt the current inputs as the baseline without alerting.
  // Legacy `occurrenceCoord=0` splits still trigger the one-time migration
  // alert on first load.
  useEffect(() => {
    const loading =
      billsQuery.isLoading || personalQuery.isLoading ||
      settingsQuery.isLoading || incomesQuery.isLoading || splitsQuery.isLoading;
    if (loading) return;

    if (!initializedRef.current) {
      initializedRef.current = true;
      if (hasLegacySplits) {
        setOptimizeAlert(
          "Bill schedule needs re-optimization — the multi-occurrence fix requires re-running Optimize so each pay week gets the correct allocation.",
        );
        return;
      }
    }

    const baseline = parseOptimizedSig(settings?.optimizedInputsSig);
    if (!baseline) {
      if (!baselineAdoptedRef.current) {
        baselineAdoptedRef.current = true;
        saveOptimizedSig(inputSigs).catch((err) => console.error("Saving optimize baseline failed:", err));
      }
      return;
    }

    if (inputSigs.bills !== baseline.bills) {
      setOptimizeAlert("Bills were added or updated.");
    } else if (inputSigs.incomes !== baseline.incomes) {
      setOptimizeAlert("Income was added or updated.");
    } else if (inputSigs.personals !== baseline.personals) {
      setOptimizeAlert("Personal expenses were added or updated.");
    } else if (inputSigs.surplusTarget !== baseline.surplusTarget) {
      setOptimizeAlert("Weekly surplus target was changed.");
    } else {
      // Inputs match what was last optimized — drop any stale change alert.
      setOptimizeAlert((prev) => (prev && INPUT_CHANGE_ALERTS.has(prev) ? null : prev));
    }
  }, [inputSigs, settings?.optimizedInputsSig, hasLegacySplits, billsQuery.isLoading, personalQuery.isLoading, settingsQuery.isLoading, incomesQuery.isLoading, splitsQuery.isLoading]);

  // ── Optimize action ──
  // PHASE A (planOptimize, lib/optimize-plan.ts) plans the next
  // OPTIMIZE_HORIZON_MONTHS months with zero DB writes; PHASE B below applies
  // the deletes/creates. Locked-week preservation and every fail-loud guard
  // live in planOptimize — see its doc comment.
  const handleOptimize = async () => {
    if (isOptimizing || !primaryIncome) return;
    setIsOptimizing(true);
    try {
      // PHASE A — plan every month WITHOUT touching the DB (pure function in
      // lib/optimize-plan.ts). The balance algorithm + underfunded / locked-
      // week assertions can throw; doing all of that before the first delete
      // means a failure leaves the DB exactly as it was, instead of the old
      // behaviour (delete a month's rows, then die halfway through
      // re-creating them — which silently dropped two split bills from
      // Oct 2026 and inflated that week's surplus).
      const writePlans = planOptimize({
        today,
        bills,
        personalBills,
        incomes,
        primaryIncome,
        splitRows: splitRowsRaw,
        targetSurplusCents,
      });

      // PHASE B — apply. Delete-then-create is intentional: there's no
      // `upsert` for a composite key that includes occurrenceCoord, and the
      // algorithm may add/remove splits (not just change amounts). Locked-week
      // rows are excluded from `toDelete` so they survive.
      for (const plan of writePlans) {
        for (const o of plan.toDelete) {
          await deleteSplit({ resource: "BillSplit", id: o.id, successNotification: false, errorNotification: false });
        }
        for (const a of plan.toCreate) {
          await createSplit({
            resource: "BillSplit",
            values: {
              billId: a.billId,
              monthKey: plan.mk,
              weekIndex: a.weekIndex,
              amountCents: a.amountCents,
              occurrenceCoord: a.occurrenceCoord,
            },
            successNotification: false,
            errorNotification: false,
          });
        }
      }

      // Success only — the alert and the baseline signature are cleared/saved
      // ONLY when every write landed, so a failed run keeps nagging.
      await saveOptimizedSig(inputSigs);
      setOptimizeAlert(null);
      showToast(`Pay weeks optimized across the next ${OPTIMIZE_HORIZON_MONTHS} months!`, "success");
    } catch (err: any) {
      console.error("Optimize failed:", err);
      showToast(`Optimize failed: ${err?.message ?? String(err)}`, "error");
    } finally {
      setIsOptimizing(false);
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
        open={toastOpen}
        // Errors stay up longer so there's time to read the message.
        autoHideDuration={toastSeverity === "error" ? 8000 : 3000}
        onClose={() => setToastOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        slots={{ transition: Fade }}
        slotProps={{ transition: { onExited: () => setToastMsg("") } }}
      >
        <Alert severity={toastSeverity} variant="filled" onClose={() => setToastOpen(false)}>
          {toastMsg}
        </Alert>
      </Snackbar>

    </Box>
  );
}
