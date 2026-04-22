"use client";

import { FC, useMemo } from "react";
import { Box, Typography, Paper, Grid } from "@mui/material";
import { SummarySection } from "./SummarySection";
import { COLORS } from "../../lib/constants";

interface IncomeGapAnalysisProps {
  settings: any;
  bills: any[];
  personalBills: any[];
  yearlyCosts: any[];
  withdrawals?: any[];
}

export const IncomeGapAnalysis: FC<IncomeGapAnalysisProps> = ({
  settings,
  bills,
  personalBills,
  yearlyCosts,
  withdrawals = [],
}) => {
  const taxRate = Number(settings?.upworkTaxProvisionPercent) || 0;
  const standardFee = 0.1; // Assuming 10% standard UpWork fee

  const metrics = useMemo(() => {
    // 1. Monthly Expenses
    const monthlyBills = bills.reduce(
      (acc, b) => acc + (Number(b.amount) || 0),
      0,
    );
    const monthlyPersonal = personalBills.reduce(
      (acc, p) => acc + (Number(p.amount) || 0),
      0,
    );
    const monthlyYearly =
      yearlyCosts.reduce((acc, y) => acc + (Number(y.amount) || 0), 0) / 12;

    const wifeAmount = Number(settings?.wifeMonthlyAmount) || 0;

    const expensesHold = settings?.upworkExpensesHoldActive
      ? Number(settings?.upworkExpensesHoldAmount) || 0
      : 0;
    // Assuming 2 withdrawals per month for the hold calculation
    const monthlyExpensesHold = expensesHold * 2;

    const totalMonthlyNeeded =
      monthlyBills +
      monthlyPersonal +
      monthlyYearly +
      wifeAmount +
      monthlyExpensesHold;

    // 2. Back-calculate Gross needed
    // Net = Gross * (1 - Fee)
    // TakeHome = Net * (1 - Tax)
    // Gross = TakeHome / ((1 - Fee) * (1 - Tax))
    const multiplier = (1 - standardFee) * (1 - taxRate);
    const monthlyGrossNeeded = totalMonthlyNeeded / multiplier;
    const weeklyGrossNeeded = monthlyGrossNeeded / 4;

    return {
      monthlyExpenses: totalMonthlyNeeded,
      monthlyGross: monthlyGrossNeeded,
      weeklyGross: weeklyGrossNeeded,
      takeHomeTarget: totalMonthlyNeeded,
      monthlyHold: monthlyExpensesHold,
    };
  }, [bills, personalBills, yearlyCosts, taxRate, settings]);

  return (
    <SummarySection title="Income Bridge Analysis (Gap Coverage)">
      <Box sx={{ mb: 3 }}>
        <Typography
          variant="body2"
          sx={{ color: "text.secondary", mb: 3, fontStyle: "italic" }}
        >
          This analysis shows the UpWork earnings required to fully cover your
          expenses if EDD and W2 income were inactive.
        </Typography>

        <Grid container spacing={2}>
          {/* Target Take-Home */}
          <Grid
            size={{
              xs: 12,
              sm: 6,
              md: settings?.upworkExpensesHoldActive ? 3 : 4,
            }}
          >
            <Paper
              sx={{
                p: 3,
                bgcolor: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderTop: `4px solid ${COLORS.gross}`,
                textAlign: "center",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  fontWeight: 800,
                  letterSpacing: "1px",
                  mb: 1,
                }}
              >
                TARGET TAKE-HOME
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 900, color: "white" }}>
                $
                {metrics.monthlyExpenses.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </Typography>
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", mt: 0.5 }}
              >
                Monthly Net Needs
              </Typography>
            </Paper>
          </Grid>

          {/* Expenses Hold (Optional) */}
          {settings?.upworkExpensesHoldActive && (
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Paper
                sx={{
                  p: 3,
                  bgcolor: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderTop: "4px solid #f43f5e",
                  textAlign: "center",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    color: "text.secondary",
                    fontWeight: 800,
                    letterSpacing: "1px",
                    mb: 1,
                  }}
                >
                  EXPENSE HOLD
                </Typography>
                <Typography
                  variant="h4"
                  sx={{ fontWeight: 900, color: "white" }}
                >
                  $
                  {metrics.monthlyHold.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ color: "text.secondary", mt: 0.5 }}
                >
                  Total Monthly Reserve
                </Typography>
              </Paper>
            </Grid>
          )}

          {/* Needed Monthly Gross */}
          <Grid
            size={{
              xs: 12,
              sm: 6,
              md: settings?.upworkExpensesHoldActive ? 3 : 4,
            }}
          >
            <Paper
              sx={{
                p: 3,
                bgcolor: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderTop: `4px solid ${COLORS.tax}`,
                textAlign: "center",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  fontWeight: 800,
                  letterSpacing: "1px",
                  mb: 1,
                }}
              >
                NEEDED MONTHLY GROSS
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 900, color: "white" }}>
                $
                {metrics.monthlyGross.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </Typography>
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", mt: 0.5 }}
              >
                UpWork Revenue Target
              </Typography>
            </Paper>
          </Grid>

          {/* Needed Weekly Gross */}
          <Grid
            size={{
              xs: 12,
              sm: 6,
              md: settings?.upworkExpensesHoldActive ? 3 : 4,
            }}
          >
            <Paper
              sx={{
                p: 3,
                bgcolor: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderTop: `4px solid ${COLORS.hand}`,
                textAlign: "center",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  fontWeight: 800,
                  letterSpacing: "1px",
                  mb: 1,
                }}
              >
                NEEDED WEEKLY GROSS
              </Typography>
              <Typography
                variant="h4"
                sx={{ fontWeight: 900, color: COLORS.hand }}
              >
                $
                {metrics.weeklyGross.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </Typography>
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", mt: 0.5 }}
              >
                Target per Week
              </Typography>
            </Paper>
          </Grid>
        </Grid>

        <Box sx={{ mt: 4, p: 2, bgcolor: "rgba(0,0,0,0.2)", borderRadius: 1 }}>
          <Typography
            variant="caption"
            sx={{
              display: "block",
              color: "text.secondary",
              textAlign: "center",
            }}
          >
            Calculation assumes a standard 10% UpWork fee and your configured{" "}
            {(taxRate * 100).toFixed(0)}% tax provision.
          </Typography>
        </Box>
      </Box>
    </SummarySection>
  );
};
