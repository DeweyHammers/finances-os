"use client";

/**
 * PersonalOverview — pay-week breakdown of personal (non-bill) expenses.
 *
 * Renders three flavors of personal item per pay period:
 *   1. `repeatWeekly` — a flat entry every pay week (Gas, Spending, etc.).
 *   2. Fixed with `weekOfMonth` or `dueDate` — appears in exactly one week.
 *   3. `splitAcrossWeeks` — monthly amount distributed proportionally via
 *      `computeSplitPersonalAllocations` so surplus-target headroom is honored
 *      each pay week (the split's share shrinks in weeks with heavy bills).
 *
 * Read-only presenter. Needs `bills` + `incomes` in addition to
 * `personalBills` because split distribution depends on per-week room
 * (income − bills − fixed personal). `splits` are the BillSplit rows so
 * bill-side allocations aren't miscounted while sizing split personals.
 */

import { Box, Grid, Typography, Paper } from "@mui/material";
import { SummarySection } from "./SummarySection";
import { DashboardCard } from "./DashboardCard";
import PersonIcon from "@mui/icons-material/Person";
import {
  getPayPeriodsForMonth,
  getBillPeriodKey,
  getBillAllocationCentsForPeriod,
  getBillOccurrenceInPeriod,
  computeSplitPersonalAllocations,
  monthKeyOf,
  BillSplitRecord,
  PayPeriod,
} from "../../lib/pay-period-utils";

interface PersonalBill {
  id: string;
  name: string;
  amount: number;
  dueDate: number;
  weekOfMonth?: number | null;
  repeatWeekly: boolean;
  splitAcrossWeeks?: boolean;
}

interface PersonalOverviewProps {
  personalBills: PersonalBill[];
  bills?: any[];
  incomes?: any[];
  settings: any;
  viewYear?: number;
  viewMonth?: number;
  splits?: BillSplitRecord[];
}

export const PersonalOverview: React.FC<PersonalOverviewProps> = ({
  personalBills,
  bills = [],
  incomes = [],
  settings,
  viewYear,
  viewMonth,
  splits = [],
}) => {
  if (!settings) return null;

  const payWeekday: number =
    settings.payDay != null ? Number(settings.payDay) : 2;
  const biWeekly = settings.paymentCycle === "BI_WEEKLY";

  const today = new Date();
  const year = viewYear ?? today.getFullYear();
  const month = viewMonth ?? today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const periods = getPayPeriodsForMonth(year, month, payWeekday, today, biWeekly);
  const monthKey = monthKeyOf(year, month);

  // ── Partition personals by allocation strategy ──
  // fixed = single-week or repeat-weekly items (amount displayed as-is).
  // split = monthly amount that needs to be sliced across pay weeks.
  const fixedPersonals = personalBills.filter((p) => !p.splitAcrossWeeks);
  const splitPersonals = personalBills.filter((p) => p.splitAcrossWeeks);

  // Monthly personal total: repeats × N, split as monthly total once, fixed once.
  // Multiplying repeatWeekly items by period count is intentional — user sees
  // "Gas $80" but the real monthly obligation is $80 × pay weeks in this view.
  const totalPersonal = personalBills.reduce((acc, curr) => {
    const amount = Number(curr.amount) || 0;
    if (curr.repeatWeekly) return acc + amount * periods.length;
    return acc + amount;
  }, 0);

  // ── Room-per-period inputs for split distribution ──
  // These three arrays (income, bills, fixed personal) feed
  // computeSplitPersonalAllocations so it can compute what's left after fixed
  // obligations in each week and keep the surplus target satisfied.
  const incomePerPeriodCents: number[] = periods.map((period) => {
    let total = 0;
    incomes.forEach((income: any) => {
      const incomePayDay = Number(income.payDay ?? payWeekday);
      const isBW = (income.paymentCycle ?? settings.paymentCycle) === "BI_WEEKLY";
      const offset = Number(income.payWeekOffset ?? 0);
      const paydays: number[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        if (new Date(year, month, d).getDay() === incomePayDay) paydays.push(d);
      }
      const effective = isBW ? paydays.filter((_, i) => i % 2 === offset) : paydays;
      if (effective.some((d) => d >= period.startDay && d <= period.endDay)) {
        total += Math.round((Number(income.amount) || 0) * 100);
      }
    });
    return total;
  });

  const billsPerPeriodCents = periods.map((period) =>
    bills.reduce(
      (acc, b) =>
        acc +
        getBillAllocationCentsForPeriod(
          b.id,
          Number(b.dueDate),
          Number(b.amount) || 0,
          periods,
          monthKey,
          splits,
          period.key,
        ),
      0,
    ),
  );

  const fixedPersonalPerPeriodCents = periods.map((period) =>
    fixedPersonals
      .filter((b) => {
        if (b.repeatWeekly) return true;
        const key =
          b.weekOfMonth != null
            ? `P${b.weekOfMonth}`
            : getBillPeriodKey(Number(b.dueDate), periods);
        return key === period.key;
      })
      .reduce((acc, p) => acc + Math.round((Number(p.amount) || 0) * 100), 0),
  );

  const targetSurplusCents = Number(settings?.wifeWeeklyTargetCents ?? 30000);

  const splitAlloc = computeSplitPersonalAllocations({
    periods,
    incomePerPeriodCents,
    fixedPersonalPerPeriodCents,
    billsPerPeriodCents,
    targetSurplusCents,
    splits: splitPersonals.map((p) => ({ id: p.id, amount: Number(p.amount) || 0 })),
  });

  // Two ways to bind a fixed personal to a pay week:
  //   - explicit `weekOfMonth` (user override, always wins) → `P{n}`
  //   - fallback to natural attribution by `dueDate` via `getBillPeriodKey`
  //     which handles forward-extension across the view boundary.
  const getFixedPeriodKey = (b: PersonalBill) => {
    if (b.weekOfMonth != null) return `P${b.weekOfMonth}`;
    return getBillPeriodKey(Number(b.dueDate), periods);
  };

  const getPeriodFixedBills = (period: PayPeriod) =>
    fixedPersonals.filter(
      (b) => b.repeatWeekly || getFixedPeriodKey(b) === period.key,
    );

  // Drop zero-cent split slices — a split can legitimately allocate $0 to a
  // week if all room is consumed by bills, and rendering a $0 card is noise.
  const getPeriodSplitAllocations = (period: PayPeriod, i: number) =>
    splitPersonals
      .map((sp) => {
        const cents = splitAlloc.perSplitPerPeriod.get(sp.id)?.[i] ?? 0;
        return { bill: sp, cents };
      })
      .filter((x) => x.cents > 0);

  const activePeriods = periods.filter(
    (p, i) =>
      getPeriodFixedBills(p).length > 0 ||
      getPeriodSplitAllocations(p, i).length > 0,
  );

  const renderPeriod = (period: PayPeriod, i: number) => {
    // Prefer occurrence-in-period coord for sort (handles next-month forward
    // extension correctly); fall back to raw dueDate when the item has no
    // resolved occurrence in this period (e.g. weekOfMonth-pinned items).
    const occCoord = (b: PersonalBill): number => {
      const occ = getBillOccurrenceInPeriod(Number(b.dueDate), period);
      return occ ? occ.coord : Number(b.dueDate) || 0;
    };
    // Sort order: repeatWeekly items first (they anchor every week), then
    // dated items in chronological order within the week.
    const fixedForPeriod = getPeriodFixedBills(period).sort((a, b) => {
      if (a.repeatWeekly && !b.repeatWeekly) return -1;
      if (!a.repeatWeekly && b.repeatWeekly) return 1;
      return occCoord(a) - occCoord(b);
    });
    const splitsForPeriod = getPeriodSplitAllocations(period, i);

    if (fixedForPeriod.length === 0 && splitsForPeriod.length === 0) return null;

    const subtotal =
      fixedForPeriod.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0) +
      splitsForPeriod.reduce((acc, x) => acc + x.cents / 100, 0);

    return (
      // Responsive width based on ACTIVE (non-empty) periods — mirrors the
      // pattern in BillsOverview so both sections align column-by-column.
      <Grid
        key={period.key}
        size={{
          xs: 12,
          sm: activePeriods.length > 1 ? 6 : 12,
          md: activePeriods.length > 0 ? 12 / activePeriods.length : 12,
        }}
      >
        <Box
          sx={{
            mb: 2,
            borderRadius: 2,
            border: period.isCurrent
              ? `1px solid ${period.color}55`
              : "1px solid transparent",
            p: period.isCurrent ? 1.5 : 0,
            bgcolor: period.isCurrent ? `${period.color}0a` : "transparent",
          }}
        >
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              mb: 1.5,
              px: 1,
              borderBottom: `1px solid ${period.color}33`,
              pb: 1,
            }}
          >
            <Box>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 900,
                  color: period.color,
                  textTransform: "uppercase",
                  letterSpacing: "1.5px",
                  display: "block",
                }}
              >
                {period.label}
                {period.isCurrent && (
                  <Box
                    component="span"
                    sx={{
                      ml: 1,
                      px: 0.75,
                      py: 0.1,
                      bgcolor: `${period.color}22`,
                      borderRadius: 1,
                      fontSize: "0.6rem",
                      verticalAlign: "middle",
                    }}
                  >
                    NOW
                  </Box>
                )}
              </Typography>
              <Typography
                variant="caption"
                sx={{ color: "text.disabled", fontSize: "0.65rem" }}
              >
                {period.dateRange}
              </Typography>
            </Box>
            <Typography
              variant="caption"
              sx={{ fontWeight: 800, color: "text.secondary", letterSpacing: 0.5 }}
            >
              TOTAL:{" "}
              <span style={{ color: "white" }}>
                $
                {subtotal.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </Typography>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            {fixedForPeriod.map((bill) => (
              <DashboardCard
                key={bill.id}
                name={bill.name}
                amount={bill.amount}
                subtitle={
                  bill.repeatWeekly
                    ? "Every week"
                    : bill.weekOfMonth != null
                      ? `Week ${bill.weekOfMonth}`
                      : undefined
                }
                color={period.color}
              />
            ))}
            {splitsForPeriod.map(({ bill, cents }) => {
              const monthly = Number(bill.amount) || 0;
              return (
                <DashboardCard
                  key={bill.id}
                  name={bill.name}
                  amount={cents / 100}
                  subtitle={`Split · $${monthly.toFixed(2)}/mo`}
                  color={period.color}
                />
              );
            })}
          </Box>
        </Box>
      </Grid>
    );
  };

  return (
    <SummarySection
      title="Personal"
      icon={<PersonIcon />}
    >
      <Grid container spacing={3}>
        {personalBills.length > 0 ? (
          periods.map((p, i) => renderPeriod(p, i))
        ) : (
          <Grid size={{ xs: 12 }}>
            <Paper
              elevation={0}
              sx={{
                py: 6,
                textAlign: "center",
                bgcolor: "rgba(15, 23, 42, 0.2)",
                borderRadius: 3,
                border: "1px dashed rgba(255,255,255,0.05)",
              }}
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontStyle: "italic", fontWeight: 600 }}
              >
                No personal items recorded
              </Typography>
            </Paper>
          </Grid>
        )}
      </Grid>
    </SummarySection>
  );
};
