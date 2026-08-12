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


  const allSources = incomes.length > 0
    ? incomes
    : [{ name: "Income", amount: settings.w2Amount, paymentCycle: settings.paymentCycle, payDay: settings.payDay, payWeekOffset: 0 }];

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

  // Distribute each split personal proportionally across weeks so the wife
  // target still clears in each week.
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
                slotProps={{
                  tooltip: {
                    sx: {
                      bgcolor: "rgba(15, 23, 42, 0.96)",
                      border: "1px solid rgba(129, 140, 248, 0.25)",
                      borderRadius: 2,
                      p: 1.5,
                      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                      "& .MuiTooltip-arrow": { color: "rgba(15, 23, 42, 0.96)" },
                    },
                  },
                }}
                title={
                  <Box>
                    {incomeSources.length === 0 ? (
                      <Typography sx={{ fontSize: "0.8rem", color: "text.secondary" }}>No income this week</Typography>
                    ) : (
                      incomeSources.map((s) => (
                        <Box key={s.name} sx={{ display: "flex", justifyContent: "space-between", gap: 3 }}>
                          <Typography sx={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.7)" }}>{s.name}</Typography>
                          <Typography sx={{ fontSize: "0.8rem", fontWeight: 800, color: "#3DBC83" }}>${s.amount.toFixed(2)}</Typography>
                        </Box>
                      ))
                    )}
                  </Box>
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
                slotProps={{
                  tooltip: {
                    sx: {
                      bgcolor: "rgba(15, 23, 42, 0.96)",
                      border: "1px solid rgba(129, 140, 248, 0.25)",
                      borderRadius: 2,
                      p: 1.5,
                      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                      "& .MuiTooltip-arrow": { color: "rgba(15, 23, 42, 0.96)" },
                    },
                  },
                }}
                title={
                  <Box>
                    {expensesBreakdown.bills > 0 && (
                      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 3 }}>
                        <Typography sx={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.7)" }}>Bills</Typography>
                        <Typography sx={{ fontSize: "0.8rem", fontWeight: 800, color: "#f43f5e" }}>${expensesBreakdown.bills.toFixed(2)}</Typography>
                      </Box>
                    )}
                    {expensesBreakdown.personal > 0 && (
                      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 3 }}>
                        <Typography sx={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.7)" }}>Personal</Typography>
                        <Typography sx={{ fontSize: "0.8rem", fontWeight: 800, color: "#f43f5e" }}>${expensesBreakdown.personal.toFixed(2)}</Typography>
                      </Box>
                    )}
                    {expensesBreakdown.bills === 0 && expensesBreakdown.personal === 0 && (
                      <Typography sx={{ fontSize: "0.8rem", color: "text.secondary" }}>No expenses this week</Typography>
                    )}
                  </Box>
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
