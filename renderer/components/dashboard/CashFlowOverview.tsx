import { FC } from "react";
import { Box, Grid, Typography, Paper, Chip } from "@mui/material";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import { getCycleColor, getCyclesForPaymentCycle } from "../../lib/cycle-utils";
import {
  startOfMonth,
  endOfMonth,
  eachWeekOfInterval,
  addDays,
} from "date-fns";
import { calculateWeeklyGrossEarnings } from "../../lib/earnings-utils";

interface CashFlowOverviewProps {
  settings: any;
  bills: any[];
  personalBills: any[];
  contracts: any[];
  earnings: any[];
  withdrawals: any[];
}

export const CashFlowOverview: FC<CashFlowOverviewProps> = ({
  settings,
  bills,
  personalBills,
  contracts,
  earnings,
  withdrawals = [],
}) => {
  if (!settings) return null;
  const paymentCycle = settings.paymentCycle || "BI_WEEKLY";
  const cycles = getCyclesForPaymentCycle(paymentCycle);

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const getCycleIncome = (cycle: string) => {
    let income = 0;
    let totalEddDeduction = 0;
    let eddIncome = 0;
    let w2Income = 0;
    let upworkIncome = 0;
    let w2Deduction = 0;
    let upworkDeduction = 0;

    let cycleSundays: Date[] = [];
    let cyclePayDate: Date;
    let prevPayDate: Date;

    if (paymentCycle === "BI_WEEKLY") {
      const targetDay = cycle === "Q2" ? 15 : 1;
      const d = new Date(now.getFullYear(), now.getMonth(), targetDay);
      d.setHours(0, 0, 0, 0);

      // If the pay date is in the past, roll it to the next month
      if (d <= now) {
        d.setMonth(d.getMonth() + 1);
      }

      cyclePayDate = d;
      prevPayDate = new Date(cyclePayDate);
      if (cycle === "Q1") {
        // Q1 (1st) covers earnings from the 15th of the previous month
        prevPayDate.setMonth(prevPayDate.getMonth() - 1);
        prevPayDate.setDate(15);
      } else {
        // Q2 (15th) covers earnings from the 1st of the same month
        prevPayDate.setDate(1);
      }
      prevPayDate.setHours(0, 0, 0, 0);

      // Sundays for EDD: The two Sundays preceding the pay date
      const s1 = new Date(cyclePayDate);
      s1.setDate(s1.getDate() - s1.getDay());
      const s2 = new Date(s1);
      s2.setDate(s2.getDate() - 7);
      cycleSundays = [s2, s1];
    } else if (paymentCycle === "WEEKLY") {
      const monthStart = startOfMonth(now);
      const monthEnd = endOfMonth(now);
      const sundaysInMonth = eachWeekOfInterval({
        start: monthStart,
        end: monthEnd,
      }).filter((s) => s.getMonth() === now.getMonth());
      const index = parseInt(cycle.replace("Q", "")) - 1;
      cyclePayDate = sundaysInMonth[index] || now;
      prevPayDate = addDays(cyclePayDate, -7);
      cycleSundays = [cyclePayDate];
    } else {
      cyclePayDate = endOfMonth(now);
      prevPayDate = startOfMonth(now);
      prevPayDate = addDays(prevPayDate, -1);
      cycleSundays = eachWeekOfInterval({
        start: startOfMonth(now),
        end: endOfMonth(now),
      });
    }

    // 1. EDD Income & Deduction
    if (settings.eddActive) {
      const baseWba = Number(settings.baseEddWeeklyAmount) || 0;

      cycleSundays.forEach((sunday) => {
        const weeklyUpworkGross = calculateWeeklyGrossEarnings(
          sunday,
          contracts,
          earnings,
          false, // actuals only
        );
        const weeklyW2Gross = settings.w2Active
          ? Number(settings.w2Amount) || 0
          : 0;
        const weeklyTotalGross = weeklyUpworkGross + weeklyW2Gross;

        let weeklyDeduction = 0;
        if (weeklyTotalGross > 0) {
          if (weeklyTotalGross <= 100) {
            weeklyDeduction = Math.max(0, weeklyTotalGross - 25);
          } else {
            weeklyDeduction = weeklyTotalGross * 0.75;
          }
        }

        // Cap deduction at base benefit
        weeklyDeduction = Math.min(baseWba, weeklyDeduction);

        if (weeklyTotalGross > 0) {
          upworkDeduction +=
            (weeklyUpworkGross / weeklyTotalGross) * weeklyDeduction;
          w2Deduction += (weeklyW2Gross / weeklyTotalGross) * weeklyDeduction;
        }

        eddIncome += baseWba;
        totalEddDeduction += weeklyDeduction;
      });
    }

    // 2. W2 Income
    if (settings.w2Active) {
      const weeklyW2 = Number(settings.w2Amount);
      if (paymentCycle === "MONTHLY") w2Income = weeklyW2 * 4;
      else if (paymentCycle === "BI_WEEKLY") w2Income = weeklyW2 * 2;
      else w2Income = weeklyW2;
    }

    // 3. UpWork Income (Withdrawals Only)
    if (settings.upworkActive !== false) {
      const minWithdrawal = Number(settings.upworkMinWithdrawalAmount) || 0;
      const taxRate = Number(settings.upworkTaxProvisionPercent) || 0;
      const expensesHold = settings.upworkExpensesHoldActive
        ? Number(settings.upworkExpensesHoldAmount) || 0
        : 0;

      const cycleEarnings = earnings.filter((e) => {
        if (e.isWithdrawn) return false;
        const eTime = new Date(e.date).getTime();
        // Use timestamps for reliable comparison
        return eTime > prevPayDate.getTime() && eTime <= cyclePayDate.getTime();
      });

      const totalCycleEarnings = cycleEarnings.reduce(
        (acc, e) => acc + Number(e.amount),
        0,
      );

      // Check if gross earnings meet the minimum withdrawal threshold
      if (totalCycleEarnings >= minWithdrawal) {
        // Net Income = (Gross - Expense Hold) * (1 - Tax Rate)
        const afterHold = Math.max(0, totalCycleEarnings - expensesHold);
        upworkIncome = afterHold * (1 - taxRate);
      }
    }

    income = eddIncome + w2Income + upworkIncome;

    return {
      income,
      eddDeduction: totalEddDeduction,
      breakdown: {
        edd: eddIncome,
        w2: w2Income,
        upwork: upworkIncome,
      },
      deductionBreakdown: {
        upwork: upworkDeduction,
        w2: w2Deduction,
      },
    };
  };

  const getCycleExpenses = (cycle: string) => {
    const cycleBills = bills.filter((b) =>
      paymentCycle === "MONTHLY" ? true : b.withdrawalCycle === cycle,
    );
    const cyclePersonal = personalBills.filter((b) =>
      paymentCycle === "MONTHLY" ? true : b.withdrawalCycle === cycle,
    );

    return (
      cycleBills.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0) +
      cyclePersonal.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
    );
  };

  const cycleData = cycles.map((cycle) => {
    const { income, eddDeduction, breakdown, deductionBreakdown } =
      getCycleIncome(cycle);
    const expenses = getCycleExpenses(cycle);
    return {
      cycle,
      income,
      eddDeduction,
      expenses,
      breakdown,
      deductionBreakdown,
      allowance: income - expenses - eddDeduction,
    };
  });

  const totalAllowance = cycleData.reduce(
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

    return (
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "baseline",
          justifyContent: "center",
          color: color,
          width: "100%",
          pt: 2,
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
    cycle,
    amount,
    income,
    expenses,
    eddDeduction,
    breakdown,
    deductionBreakdown,
  }: any) => {
    const cycleColor = getCycleColor(cycle);

    return (
      <Paper
        sx={{
          p: 3,
          borderRadius: 4,
          display: "flex",
          flexDirection: "column",
          bgcolor: amount < 0 ? "rgba(239, 68, 68, 0.08)" : `${cycleColor}15`,
          border: `1px solid ${amount < 0 ? "rgba(239, 68, 68, 0.2)" : `${cycleColor}40`}`,
          textAlign: "center",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          flex: 1,
          width: "100%",
          justifyContent: "space-between",
        }}
      >
        <Box>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 900,
              color: "text.secondary",
              letterSpacing: "4px",
              mb: 3,
              textTransform: "uppercase",
              fontSize: "1.1rem",
              opacity: 0.9,
            }}
          >
            {cycle === "MONTH" ? "MONTHLY" : cycle} ALLOWANCE
          </Typography>

          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: eddDeduction > 0 ? 4 : 6 }}>
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  color: "text.secondary",
                  fontWeight: 700,
                  fontSize: "0.65rem",
                  mb: 0.5,
                }}
              >
                INCOME
              </Typography>
              <Typography
                variant="body1"
                sx={{ fontWeight: 900, color: "success.main" }}
              >
                ${income.toFixed(2)}
              </Typography>

              {/* Breakdown back inside the column */}
              <Box
                sx={{
                  mt: 1.5,
                  p: 1,
                  bgcolor: "rgba(0,0,0,0.25)",
                  borderRadius: 1.5,
                  border: "1px solid rgba(255,255,255,0.05)",
                  textAlign: "left",
                  width: "125px",
                  mx: "auto",
                }}
              >
                {breakdown.w2 > 0 && (
                  <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      fontSize: "0.65rem",
                      fontWeight: 800,
                      lineHeight: 1.4,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ color: "rgba(255, 255, 255, 0.6)" }}>
                      W2:
                    </span>{" "}
                    <span style={{ color: "#23a559" }}>
                      ${breakdown.w2.toFixed(0)}
                    </span>
                  </Typography>
                )}
                {breakdown.edd > 0 && (
                  <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      fontSize: "0.65rem",
                      fontWeight: 800,
                      lineHeight: 1.4,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ color: "rgba(255, 255, 255, 0.6)" }}>
                      EDD:
                    </span>{" "}
                    <span style={{ color: "#23a559" }}>
                      ${breakdown.edd.toFixed(0)}
                    </span>
                  </Typography>
                )}
                {breakdown.upwork > 0 && (
                  <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      fontSize: "0.65rem",
                      fontWeight: 800,
                      lineHeight: 1.4,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ color: "rgba(255, 255, 255, 0.6)" }}>
                      UpWork:
                    </span>{" "}
                    <span style={{ color: "#23a559" }}>
                      ${breakdown.upwork.toFixed(0)}
                    </span>
                  </Typography>
                )}
              </Box>
            </Grid>

            {eddDeduction > 0 && (
              <Grid size={{ xs: 4 }}>
                <Typography
                  variant="caption"
                  sx={{
                    display: "block",
                    color: "error.light",
                    fontWeight: 800,
                    fontSize: "0.65rem",
                    mb: 0.5,
                  }}
                >
                  DEDUCTION
                </Typography>
                <Typography
                  variant="body1"
                  sx={{ fontWeight: 900, color: "error.light" }}
                >
                  -${eddDeduction.toFixed(2)}
                </Typography>

                <Box
                  sx={{
                    mt: 1.5,
                    p: 1,
                    bgcolor: "rgba(0,0,0,0.25)",
                    borderRadius: 1.5,
                    border: "1px solid rgba(255,255,255,0.05)",
                    textAlign: "left",
                    width: "125px",
                    mx: "auto",
                  }}
                >
                  {deductionBreakdown.w2 > 0 && (
                    <Typography
                      variant="caption"
                      sx={{
                        display: "block",
                        fontSize: "0.65rem",
                        fontWeight: 800,
                        lineHeight: 1.4,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ color: "rgba(239, 68, 68, 0.6)" }}>
                        W2:
                      </span>{" "}
                      <span style={{ color: "#ef4444" }}>
                        -${deductionBreakdown.w2.toFixed(0)}
                      </span>
                    </Typography>
                  )}
                  {deductionBreakdown.upwork > 0 && (
                    <Typography
                      variant="caption"
                      sx={{
                        display: "block",
                        fontSize: "0.65rem",
                        fontWeight: 800,
                        lineHeight: 1.4,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ color: "rgba(239, 68, 68, 0.6)" }}>
                        UpWork:
                      </span>{" "}
                      <span style={{ color: "#ef4444" }}>
                        -${deductionBreakdown.upwork.toFixed(0)}
                      </span>
                    </Typography>
                  )}
                </Box>
              </Grid>
            )}

            <Grid size={{ xs: eddDeduction > 0 ? 4 : 6 }}>
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  color: "text.secondary",
                  fontWeight: 700,
                  fontSize: "0.65rem",
                  mb: 0.5,
                }}
              >
                EXPENSES
              </Typography>
              <Typography
                variant="body1"
                sx={{ fontWeight: 900, color: "error.main" }}
              >
                ${expenses.toFixed(2)}
              </Typography>
            </Grid>
          </Grid>
        </Box>

        <Box sx={{ mt: "auto" }}>
          <AmountDisplay
            amount={amount}
            color={amount < 0 ? "#ef4444" : cycleColor}
            size={cycles.length > 2 ? "medium" : "large"}
          />
        </Box>
      </Paper>
    );
  };

  return (
    <Box sx={{ mb: 6, width: "100%", maxWidth: "1400px" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 4 }}>
        <AccountBalanceWalletIcon
          sx={{ color: "primary.main", fontSize: "2.2rem" }}
        />
        <Typography
          variant="h4"
          sx={{ fontWeight: 900, letterSpacing: "-0.5px" }}
        >
          Cash Flow & Allowance
        </Typography>
      </Box>

      <Grid container spacing={3} sx={{ alignItems: "stretch" }}>
        {cycleData.map((data) => (
          <Grid
            key={data.cycle}
            size={{ xs: 12, sm: 6, md: 12 / (cycles.length + 1) }}
            sx={{ display: "flex" }}
          >
            <AllowanceCard
              cycle={data.cycle}
              amount={data.allowance}
              income={data.income}
              eddDeduction={data.eddDeduction}
              expenses={data.expenses}
              breakdown={data.breakdown}
              deductionBreakdown={data.deductionBreakdown}
            />
          </Grid>
        ))}

        <Grid
          size={{ xs: 12, sm: 6, md: 12 / (cycles.length + 1) }}
          sx={{ display: "flex" }}
        >
          <Paper
            sx={{
              p: 3,
              borderRadius: 4,
              bgcolor:
                totalAllowance < 0
                  ? "rgba(239, 68, 68, 0.08)"
                  : "rgba(35, 165, 89, 0.08)",
              border: `1px solid ${totalAllowance < 0 ? "rgba(239, 68, 68, 0.2)" : "rgba(35, 165, 89, 0.2)"}`,
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
              flex: 1,
              width: "100%",
            }}
          >
            <Box>
              <Box
                sx={{
                  height: 24,
                  mb: 2,
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                {totalAllowance < 0 ? (
                  <Chip
                    label="OVER BUDGET"
                    size="small"
                    sx={{
                      bgcolor: "#ef4444",
                      color: "white",
                      fontWeight: 900,
                      px: 1.5,
                      height: 24,
                      fontSize: "0.75rem",
                    }}
                  />
                ) : (
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      fontWeight: 700,
                      fontSize: "1.1rem",
                      textTransform: "uppercase",
                      letterSpacing: "2px",
                    }}
                  >
                    Remaining Balance
                  </Typography>
                )}
              </Box>

              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  mb: 1,
                }}
              >
                <Typography
                  variant="h5"
                  sx={{
                    fontWeight: 900,
                    color: "text.secondary",
                    letterSpacing: "2px",
                    lineHeight: 1.2,
                    fontSize: "1.3rem",
                  }}
                >
                  WIFE'S ALLOWANCE
                </Typography>
              </Box>
            </Box>

            <Box sx={{ mt: "auto" }}>
              <AmountDisplay
                amount={totalAllowance}
                color={totalAllowance < 0 ? "#ef4444" : "#23a559"}
                size={cycles.length > 2 ? "medium" : "large"}
              />
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};
