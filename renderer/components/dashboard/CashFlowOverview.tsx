/**
 * CashFlowOverview — pay-week surplus grid on the Overview page.
 *
 * For each pay period in the current view, computes income − (bills + fixed
 * personal + distributed split personal) and displays the resulting surplus
 * plus a monthly aggregate card. Splits use `computeSplitPersonalAllocations`
 * so per-week surplus-target headroom is honored proportionally rather than
 * dumping the whole monthly amount into one week.
 *
 * Read-only. Consumes `bills`, `personalBills`, `incomes`, `settings`, and
 * `splits` (persisted BillSplit rows) already fetched by the Overview page.
 */

import { FC } from "react";
import { Box, Grid, Typography, Paper, Tooltip } from "@mui/material";
import {
  getPayPeriodsForMonth,
  getBillPeriodKey,
  getBillAllocationCentsForPeriod,
  computeSplitPersonalAllocations,
  monthKeyOf,
  BillSplitRecord,
  PayPeriod,
} from "../../lib/pay-period-utils";
import {
  TooltipBody,
  TooltipTitle,
  tooltipStyleProps,
} from "../../lib/tooltip-styles";

interface CashFlowOverviewProps {
  settings: any;
  bills: any[];
  personalBills: any[];
  incomes?: any[];
  viewYear?: number;
  viewMonth?: number;
  splits?: BillSplitRecord[];
}

export const CashFlowOverview: FC<CashFlowOverviewProps> = ({
  settings,
  bills,
  personalBills,
  incomes = [],
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


  // Fallback: if no explicit Income records exist, synthesize a single source
  // from AppSettings so first-run users still see numbers instead of $0.
  const allSources = incomes.length > 0
    ? incomes
    : [{ name: "Income", amount: settings.w2Amount, paymentCycle: settings.paymentCycle, payDay: settings.payDay, payWeekOffset: 0 }];

  // Which income sources fire inside this pay period. Bi-weekly sources use
  // payWeekOffset (0 or 1) to pick alternating paydays — offset lets two
  // bi-weekly incomes sit on opposite weeks even when they share a payDay.
  const getIncomeBreakdown = (period: PayPeriod): { name: string; amount: number }[] => {
    const result: { name: string; amount: number }[] = [];
    allSources.forEach((income: any) => {
      const incomePayDay = Number(income.payDay ?? payWeekday);
      const isBiWeeklyIncome = (income.paymentCycle ?? settings.paymentCycle) === "BI_WEEKLY";
      const allPaydays: number[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        if (new Date(year, month, d).getDay() === incomePayDay) allPaydays.push(d);
      }
      const offset = Number(income.payWeekOffset ?? 0);
      const effectivePaydays = isBiWeeklyIncome ? allPaydays.filter((_, i) => i % 2 === offset) : allPaydays;
      if (effectivePaydays.some((d) => d >= period.startDay && d <= period.endDay)) {
        result.push({ name: income.name ?? "Income", amount: Number(income.amount) || 0 });
      }
    });
    return result;
  };

  // Bills per period, summing split allocations when present.
  const billsPerPeriodDollars = periods.map((period) =>
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
        ) /
          100,
      0,
    ),
  );

  // Fixed personal (excluding split-across-weeks) per period.
  const fixedPersonalPerPeriodDollars = periods.map((period) => {
    return personalBills
      .filter((b) => {
        if (b.splitAcrossWeeks) return false;
        if (b.repeatWeekly) return true;
        const key =
          b.weekOfMonth != null
            ? `P${b.weekOfMonth}`
            : getBillPeriodKey(Number(b.dueDate), periods);
        return key === period.key;
      })
      .reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  });

  // Income per period (also used as room input for split distribution).
  const incomePerPeriodDollars = periods.map((period) =>
    getIncomeBreakdown(period).reduce((s, x) => s + x.amount, 0),
  );

  // Distribute each split personal proportionally across weeks so the surplus
  // target still clears in each week. Default target = $300/wk (30000c).
  const targetSurplusCents = Number(settings?.wifeWeeklyTargetCents ?? 30000);
  const splitPersonals = personalBills.filter((p) => p.splitAcrossWeeks);
  const splitAlloc = computeSplitPersonalAllocations({
    periods,
    incomePerPeriodCents: incomePerPeriodDollars.map((d) => Math.round(d * 100)),
    fixedPersonalPerPeriodCents: fixedPersonalPerPeriodDollars.map((d) => Math.round(d * 100)),
    billsPerPeriodCents: billsPerPeriodDollars.map((d) => Math.round(d * 100)),
    targetSurplusCents,
    splits: splitPersonals.map((p) => ({ id: p.id, amount: Number(p.amount) || 0 })),
  });

  // ── Aggregate per-period rows for the AllowanceCard grid ──
  // Order matters: split allocations from computeSplitPersonalAllocations
  // must be added on top of the fixed personal baseline used as input to
  // that same function, so the two never double-count the same dollar.
  const periodData = periods.map((period, i) => {
    const incomeSources = getIncomeBreakdown(period);
    const income = incomePerPeriodDollars[i];
    const splitDollars = splitAlloc.totalSplitPerPeriod[i] / 100;
    const personal = fixedPersonalPerPeriodDollars[i] + splitDollars;
    const expenses = billsPerPeriodDollars[i] + personal;
    return {
      period,
      income,
      expenses,
      allowance: income - expenses,
      incomeSources,
      expensesBreakdown: { bills: billsPerPeriodDollars[i], personal },
    };
  });

  const totalAllowance = periodData.reduce(
    (acc, curr) => acc + curr.allowance,
    0,
  );

  // Big-number display: the dollar sign, integer part and decimal use
  // different font sizes/weights so the amount reads at a glance. Split
  // into components rather than a single Typography so the styling can
  // differ per segment (small $ prefix, huge digits, medium .XX suffix).
  const AmountDisplay = ({
    amount,
    color,
    size = "large",
  }: {
    amount: number;
    color: string;
    size?: "medium" | "large";
  }) => {
    const absAmount = Math.abs(amount);
    const integerPart = Math.floor(absAmount).toLocaleString();
    const decimalPart = absAmount.toFixed(2).split(".")[1];
    const isLarge = size === "large";
    const isNegative = amount < 0;

    return (
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "baseline",
          justifyContent: "center",
          color: color,
          width: "100%",
          mt: 2,
          pt: 3,
          borderTop: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <Typography
          sx={{
            fontSize: isLarge ? "1.4rem" : "1.1rem",
            fontWeight: 900,
            mr: 0.5,
            opacity: 0.6,
            lineHeight: 1,
          }}
        >
          $
        </Typography>
        {isNegative && (
          <Typography
            sx={{
              fontSize: isLarge ? "3.2rem" : "2.2rem",
              fontWeight: 900,
              letterSpacing: "-1.5px",
              lineHeight: 1,
            }}
          >
            -
          </Typography>
        )}
        <Typography
          sx={{
            fontSize: isLarge ? "3.2rem" : "2.2rem",
            fontWeight: 900,
            letterSpacing: "-1.5px",
            lineHeight: 1,
          }}
        >
          {integerPart}
        </Typography>
        <Typography
          sx={{
            fontSize: isLarge ? "1.6rem" : "1.2rem",
            fontWeight: 800,
            ml: 0.2,
            opacity: 0.8,
            lineHeight: 1,
          }}
        >
          .{decimalPart}
        </Typography>
      </Box>
    );
  };

  const AllowanceCard = ({
    period,
    amount,
    income,
    expenses,
    incomeSources,
    expensesBreakdown,
  }: {
    period: PayPeriod;
    amount: number;
    income: number;
    expenses: number;
    incomeSources: { name: string; amount: number }[];
    expensesBreakdown: { bills: number; personal: number };
  }) => {
    // Negative surplus → red regardless of the period's usual color, so
    // shortfall weeks visually pop against the standard color-coded grid.
    const cardColor = amount < 0 ? "#f43f5e" : period.color;

    return (
      <Paper
        elevation={0}
        sx={{
          p: 3,
          borderRadius: 4,
          display: "flex",
          flexDirection: "column",
          bgcolor: period.isCurrent
            ? `${period.color}0d`
            : "rgba(15, 23, 42, 0.55)",
          border: `1px solid ${amount < 0 ? "rgba(244, 63, 94, 0.2)" : period.isCurrent ? `${period.color}44` : "rgba(129, 140, 248, 0.1)"}`,
          textAlign: "center",
          flex: 1,
          width: "100%",
          justifyContent: "space-between",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            bgcolor: cardColor,
            opacity: 0.8,
          }}
        />

        <Box>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 900,
              color: "text.secondary",
              letterSpacing: "2px",
              mb: 0.5,
              textTransform: "uppercase",
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
                  color: period.color,
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
            sx={{
              display: "block",
              color: "text.disabled",
              fontSize: "0.65rem",
              mb: 2,
            }}
          >
            {period.dateRange}
          </Typography>

          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 6 }}>
              <Typography
                variant="caption"
                sx={{ display: "block", color: "text.secondary", fontWeight: 800, fontSize: "0.65rem", mb: 0.5 }}
              >
                INCOME
              </Typography>
              <Tooltip
                placement="top"
                arrow
                {...tooltipStyleProps(period.color)}
                title={
                  <>
                    <TooltipTitle color={period.color}>Income sources</TooltipTitle>
                    {incomeSources.length === 0 ? (
                      <TooltipBody>No income this week</TooltipBody>
                    ) : (
                      incomeSources.map((s) => (
                        <Box key={s.name} sx={{ display: "flex", justifyContent: "space-between", gap: 3 }}>
                          <Typography sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.85)", lineHeight: 1.4 }}>{s.name}</Typography>
                          <Typography sx={{ fontSize: "0.72rem", fontWeight: 800, color: "#3DBC83", lineHeight: 1.4 }}>${s.amount.toFixed(2)}</Typography>
                        </Box>
                      ))
                    )}
                  </>
                }
              >
                <Typography variant="body1" sx={{ fontWeight: 900, color: "success.light", cursor: "default", display: "inline-block" }}>
                  ${income.toFixed(0)}
                </Typography>
              </Tooltip>
            </Grid>

            <Grid size={{ xs: 6 }}>
              <Typography
                variant="caption"
                sx={{ display: "block", color: "text.secondary", fontWeight: 800, fontSize: "0.65rem", mb: 0.5 }}
              >
                EXPENSES
              </Typography>
              <Tooltip
                placement="top"
                arrow
                {...tooltipStyleProps(period.color)}
                title={
                  <>
                    <TooltipTitle color={period.color}>Expenses breakdown</TooltipTitle>
                    {expensesBreakdown.bills > 0 && (
                      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 3 }}>
                        <Typography sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.85)", lineHeight: 1.4 }}>Bills</Typography>
                        <Typography sx={{ fontSize: "0.72rem", fontWeight: 800, color: "#f43f5e", lineHeight: 1.4 }}>${expensesBreakdown.bills.toFixed(2)}</Typography>
                      </Box>
                    )}
                    {expensesBreakdown.personal > 0 && (
                      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 3 }}>
                        <Typography sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.85)", lineHeight: 1.4 }}>Personal</Typography>
                        <Typography sx={{ fontSize: "0.72rem", fontWeight: 800, color: "#f43f5e", lineHeight: 1.4 }}>${expensesBreakdown.personal.toFixed(2)}</Typography>
                      </Box>
                    )}
                    {expensesBreakdown.bills === 0 && expensesBreakdown.personal === 0 && (
                      <TooltipBody>No expenses this week</TooltipBody>
                    )}
                  </>
                }
              >
                <Typography variant="body1" sx={{ fontWeight: 900, color: "#f43f5e", cursor: "default", display: "inline-block" }}>
                  ${expenses.toFixed(0)}
                </Typography>
              </Tooltip>
            </Grid>
          </Grid>
        </Box>

        <Box sx={{ mt: "auto" }}>
          <Typography
            variant="caption"
            sx={{
              display: "block",
              color: "text.secondary",
              fontWeight: 800,
              fontSize: "0.65rem",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              mb: 0.5,
            }}
          >
            Surplus
          </Typography>
          <AmountDisplay
            amount={amount}
            color={cardColor}
            size={periods.length > 2 ? "medium" : "large"}
          />
        </Box>
      </Paper>
    );
  };

  return (
    <Box sx={{ width: "100%" }}>
      <Box sx={{ display: "flex", gap: 3, alignItems: "stretch" }}>
        {/* Pay week cards */}
        {periodData.map((data) => (
          <Box key={data.period.key} sx={{ flex: 1 }}>
            <AllowanceCard
              period={data.period}
              amount={data.allowance}
              income={data.income}
              expenses={data.expenses}
              incomeSources={data.incomeSources}
              expensesBreakdown={data.expensesBreakdown}
            />
          </Box>
        ))}

        {/* Monthly surplus total */}
        <Paper
          elevation={0}
          sx={{
            p: 3,
            borderRadius: 4,
            flexShrink: 0,
            width: 200,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            bgcolor: totalAllowance < 0 ? "rgba(244,63,94,0.08)" : "rgba(61,188,131,0.08)",
            border: `1px solid ${totalAllowance < 0 ? "rgba(244,63,94,0.25)" : "rgba(61,188,131,0.25)"}`,
            position: "relative",
            overflow: "hidden",
            textAlign: "center",
          }}
        >
          <Box
            sx={{
              position: "absolute",
              top: 0, left: 0, right: 0,
              height: 4,
              bgcolor: totalAllowance < 0 ? "#f43f5e" : "#3DBC83",
            }}
          />
          <Typography
            variant="caption"
            sx={{
              fontWeight: 900,
              color: "text.secondary",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              display: "block",
              mt: 0.5,
            }}
          >
            Monthly<br />Surplus Total
          </Typography>
          <Box>
            <AmountDisplay
              amount={totalAllowance}
              color={totalAllowance < 0 ? "#f43f5e" : "#3DBC83"}
              size="medium"
            />
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};
