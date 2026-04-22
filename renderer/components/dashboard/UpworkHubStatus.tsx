import { FC, useMemo } from "react";
import { Box, Typography, Divider, Grid } from "@mui/material";
import { addDays } from "date-fns";
import { calculateWeeklyNetEarnings } from "../../lib/earnings-utils";
import { SummarySection } from "./SummarySection";
import { DashboardCard } from "./DashboardCard";
import { COLORS } from "../../lib/constants";

interface UpworkHubStatusProps {
  settings: any;
  contracts: any[];
  earnings: any[];
  withdrawals: any[];
}

export const UpworkHubStatus: FC<UpworkHubStatusProps> = ({
  settings,
  contracts,
  earnings,
  withdrawals = [],
}) => {
  if (settings && settings.upworkActive === false) return null;

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const taxProvisionRate = Number(settings.upworkTaxProvisionPercent) || 0;
  const minWithdrawalBalance = Number(settings.upworkMinWithdrawalAmount) || 0;

  const expensesHold = settings.upworkExpensesHoldActive
    ? Number(settings.upworkExpensesHoldAmount)
    : 0;

  // 1. Withdrawal Balance Logic
  const calculateCurrentBalance = () => {
    const totalEarnings = earnings.reduce(
      (acc, e) => acc + (Number(e.amount) || 0),
      0,
    );
    const totalWithdrawals = withdrawals.reduce(
      (acc, w) => acc + (Number(w.amount) || 0),
      0,
    );
    return Math.max(0, totalEarnings - totalWithdrawals);
  };

  const totalBalance = calculateCurrentBalance();
  const withdrawableAmount = Math.max(0, totalBalance - expensesHold);

  const meetsMinBalance = totalBalance >= minWithdrawalBalance;

  // 2. EDD Logic
  const getNextReportSunday = (currentDate: Date) => {
    const reference = new Date(2026, 3, 19);
    let reportDate = reference;
    if (currentDate > reportDate) {
      while (reportDate < currentDate) {
        reportDate = addDays(reportDate, 14);
      }
    } else {
      while (addDays(reportDate, -14) >= currentDate) {
        reportDate = addDays(reportDate, -14);
      }
    }
    return reportDate;
  };

  const nextReportSunday = getNextReportSunday(now);
  const w2Amount = settings.w2Active ? Number(settings.w2Amount) : 0;

  const reportWeek1Net =
    calculateWeeklyNetEarnings(
      addDays(nextReportSunday, -14),
      contracts,
      false,
    ) + w2Amount;

  const reportWeek2Net =
    calculateWeeklyNetEarnings(
      addDays(nextReportSunday, -7),
      contracts,
      false,
    ) + w2Amount;

  // 3. Contract Counts & Totals
  const activeContracts = contracts.filter((c) => c.status === "ACTIVE");

  const activeContractCount = activeContracts.length;
  const completedContractCount = contracts.filter(
    (c) => c.status === "COMPLETED",
  ).length;

  const currentlyMadeTotals = useMemo(() => {
    // We only calculate totals from contract entries.
    // Manual income (earnings) is intentionally excluded here as it represents unwithdrawn balance,
    // which is tracked separately in the WITHDRAWAL INFO section.
    return contracts.reduce(
      (acc, c) => {
        const cEntries = c.entries || [];
        const gross = cEntries.reduce(
          (sum: number, e: any) => sum + (e.grossPay || 0),
          0,
        );
        const netBase = cEntries.reduce(
          (sum: number, e: any) => sum + (e.netPay || 0),
          0,
        );
        const savings = netBase * taxProvisionRate;
        const remaining = netBase - savings;

        acc.gross += gross;
        acc.netBase += netBase;
        acc.savings += savings;
        acc.remaining += remaining;
        return acc;
      },
      { gross: 0, netBase: 0, savings: 0, remaining: 0 },
    );
  }, [contracts, taxProvisionRate]);

  // 4. Combined Projections Math
  const hourlyProjections = useMemo(() => {
    const hourlyActive = activeContracts.filter((c) => c.type === "HOURLY");

    const calculateForActive = (multiplier: number) => {
      return hourlyActive.reduce(
        (acc, c) => {
          const gross =
            (Number(c.weeklyHours) || 0) *
            (Number(c.grossRate) || 0) *
            multiplier;
          const netBase =
            (Number(c.weeklyHours) || 0) *
            (Number(c.netRate) || 0) *
            multiplier;
          const savings = netBase * taxProvisionRate;
          const takeHome = netBase - savings;

          acc.gross += gross;
          acc.netBase += netBase;
          acc.savings += savings;
          acc.takeHome += takeHome;
          return acc;
        },
        { gross: 0, netBase: 0, savings: 0, takeHome: 0 },
      );
    };

    return {
      weekly: calculateForActive(1),
      biWeekly: calculateForActive(2),
      monthly: calculateForActive(4),
    };
  }, [activeContracts, taxProvisionRate]);

  const fixedRemainingBalance = useMemo(() => {
    const fixedActive = activeContracts.filter((c) => c.type === "FIXED");
    return fixedActive.reduce(
      (acc, c) => {
        const cEntries = c.entries || [];
        const earnedGross = cEntries.reduce(
          (sum: number, e: any) => sum + (e.grossPay || 0),
          0,
        );
        const earnedNetBase = cEntries.reduce(
          (sum: number, e: any) => sum + (e.netPay || 0),
          0,
        );

        const totalGross = Number(c.grossRate) || 0;
        const totalNetBase = Number(c.netRate) || 0;

        const remainingGross = Math.max(0, totalGross - earnedGross);
        const remainingNetBase = Math.max(0, totalNetBase - earnedNetBase);
        const savings = remainingNetBase * taxProvisionRate;
        const takeHome = remainingNetBase - savings;

        acc.gross += remainingGross;
        acc.netBase += remainingNetBase;
        acc.savings += savings;
        acc.takeHome += takeHome;
        return acc;
      },
      { gross: 0, netBase: 0, savings: 0, takeHome: 0 },
    );
  }, [activeContracts, taxProvisionRate]);

  return (
    <SummarySection title="UpWork Hub Status">
      {/* General Stats */}
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: "flex", gap: 2, mb: 3 }}>
          <Box
            sx={{
              flex: 1,
              bgcolor: "#1e293b",
              py: 1.25,
              px: 2,
              borderRadius: 1,
              borderLeft: `3px solid ${COLORS.hand}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <Typography
              variant="body2"
              sx={{ fontWeight: 700, color: "white", fontSize: "0.95rem" }}
            >
              Active Contracts
            </Typography>
            <Typography
              variant="subtitle1"
              sx={{ fontWeight: 800, color: COLORS.hand }}
            >
              {activeContractCount}
            </Typography>
          </Box>
          <Box
            sx={{
              flex: 1,
              bgcolor: "#1e293b",
              py: 1.25,
              px: 2,
              borderRadius: 1,
              borderLeft: `3px solid ${COLORS.hand}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <Typography
              variant="body2"
              sx={{ fontWeight: 700, color: "white", fontSize: "0.95rem" }}
            >
              Completed Contracts
            </Typography>
            <Typography
              variant="subtitle1"
              sx={{ fontWeight: 800, color: COLORS.hand }}
            >
              {completedContractCount}
            </Typography>
          </Box>
        </Box>

        {/* Withdrawal Info */}
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            mb: 1,
            px: 1,
            borderBottom: "1px solid rgba(16, 185, 129, 0.2)",
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 900,
              color: COLORS.hand,
              textTransform: "uppercase",
              letterSpacing: "1px",
            }}
          >
            WITHDRAWAL INFO
          </Typography>
        </Box>
        <DashboardCard
          name="Total Unwithdrawn"
          amount={totalBalance}
          color={COLORS.hand}
        />
        <DashboardCard
          name="Withdrawable Balance"
          amount={withdrawableAmount}
          subtitle={
            expensesHold > 0 ? `After $${expensesHold} Expense Hold` : undefined
          }
          color={COLORS.net}
        />
        <DashboardCard
          name="Total Tax Provision"
          amount={withdrawableAmount * taxProvisionRate}
          subtitle={`${(taxProvisionRate * 100).toFixed(0)}% of Withdrawable`}
          color={COLORS.tax}
        />
        <DashboardCard
          name="Remaining Net"
          amount={withdrawableAmount * (1 - taxProvisionRate)}
          color={COLORS.hand}
        />

        {/* New Withdrawal Prediction Section */}
        {meetsMinBalance && (
          <Box
            sx={{
              mt: 3,
              p: 2,
              borderRadius: 2,
              bgcolor: "rgba(16, 185, 129, 0.05)",
              border: "1px solid rgba(16, 185, 129, 0.2)",
            }}
          >
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 900,
                color: COLORS.net,
                mb: 2,
                textTransform: "uppercase",
                display: "flex",
                alignItems: "center",
                gap: 1,
              }}
            >
              🚀 Withdrawal Milestone Met (${minWithdrawalBalance.toFixed(0)}+)
            </Typography>

            <Grid container spacing={2}>
              <Grid size={{ xs: 6 }}>
                <Typography
                  variant="caption"
                  sx={{ color: "text.secondary", fontWeight: 700 }}
                >
                  Est. Bank Transfer
                </Typography>
                <Typography
                  variant="h6"
                  sx={{ fontWeight: 900, color: COLORS.hand }}
                >
                  ${(withdrawableAmount * (1 - taxProvisionRate)).toFixed(2)}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6 }}>
                <Typography
                  variant="caption"
                  sx={{ color: "text.secondary", fontWeight: 700 }}
                >
                  Tax Provision
                </Typography>
                <Typography
                  variant="h6"
                  sx={{ fontWeight: 900, color: COLORS.tax }}
                >
                  ${(withdrawableAmount * taxProvisionRate).toFixed(2)}
                </Typography>
              </Grid>
              {expensesHold > 0 && (
                <Grid size={{ xs: 12 }}>
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", fontWeight: 700 }}
                  >
                    Expense Hold (Reserved)
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 800, color: "warning.light" }}
                  >
                    ${expensesHold.toFixed(2)}
                  </Typography>
                </Grid>
              )}
            </Grid>

            <Typography
              variant="caption"
              sx={{
                display: "block",
                mt: 1.5,
                fontStyle: "italic",
                opacity: 0.8,
              }}
            >
              *Calculated based on your current unwithdrawn balance.
            </Typography>
          </Box>
        )}
      </Box>

      {/* EDD Report Weeks */}
      {settings.eddActive && (
        <Box sx={{ mb: 4 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 1,
              px: 1,
              borderBottom: "1px solid rgba(251, 191, 36, 0.2)",
            }}
          >
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 900,
                color: COLORS.tax,
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              EDD REPORT WEEKS
            </Typography>
          </Box>
          <DashboardCard
            name="EDD Report W1 (NET)"
            amount={reportWeek1Net}
            color={COLORS.tax}
          />
          <DashboardCard
            name="EDD Report W2 (NET)"
            amount={reportWeek2Net}
            color={COLORS.tax}
          />
        </Box>
      )}

      {/* Contracts Potential Earnings */}
      <Box sx={{ mb: 4 }}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            mb: 1,
            px: 1,
            borderBottom: "1px solid rgba(129, 140, 248, 0.2)",
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 900,
              color: "primary.light",
              textTransform: "uppercase",
              letterSpacing: "1px",
            }}
          >
            CONTRACTS POTENTIAL EARNINGS
          </Typography>
        </Box>

        {[
          { label: "WEEKLY HOURLY", data: hourlyProjections.weekly },
          { label: "BI-WEEKLY HOURLY", data: hourlyProjections.biWeekly },
          { label: "MONTHLY HOURLY", data: hourlyProjections.monthly },
        ].map((period) => (
          <Box key={period.label} sx={{ mb: 2 }}>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 800,
                color: "text.secondary",
                ml: 1,
                display: "block",
                mb: 0.5,
              }}
            >
              {period.label}
            </Typography>
            <Grid container spacing={1}>
              <Grid size={{ xs: 3 }}>
                <DashboardCard
                  name="Gross"
                  amount={period.data.gross}
                  color={COLORS.gross}
                />
              </Grid>
              <Grid size={{ xs: 3 }}>
                <DashboardCard
                  name="Net"
                  amount={period.data.netBase}
                  color={COLORS.net}
                />
              </Grid>
              <Grid size={{ xs: 3 }}>
                <DashboardCard
                  name="Tax"
                  amount={period.data.savings}
                  color={COLORS.tax}
                />
              </Grid>
              <Grid size={{ xs: 3 }}>
                <DashboardCard
                  name="Take Home"
                  amount={period.data.takeHome}
                  color={COLORS.hand}
                />
              </Grid>
            </Grid>
          </Box>
        ))}

        <Box sx={{ mb: 2 }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 800,
              color: "text.secondary",
              ml: 1,
              display: "block",
              mb: 0.5,
            }}
          >
            FIXED CONTRACTS BALANCE (REMAINING)
          </Typography>
          <Grid container spacing={1}>
            <Grid size={{ xs: 3 }}>
              <DashboardCard
                name="Gross"
                amount={fixedRemainingBalance.gross}
                color={COLORS.gross}
              />
            </Grid>
            <Grid size={{ xs: 3 }}>
              <DashboardCard
                name="Net"
                amount={fixedRemainingBalance.netBase}
                color={COLORS.net}
              />
            </Grid>
            <Grid size={{ xs: 3 }}>
              <DashboardCard
                name="Tax"
                amount={fixedRemainingBalance.savings}
                color={COLORS.tax}
              />
            </Grid>
            <Grid size={{ xs: 3 }}>
              <DashboardCard
                name="Take Home"
                amount={fixedRemainingBalance.takeHome}
                color={COLORS.hand}
              />
            </Grid>
          </Grid>
        </Box>
      </Box>

      {/* Currently Made (Total Combined) */}
      <Box sx={{ mb: 4 }}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            mb: 1,
            px: 1,
            borderBottom: "1px solid rgba(16, 185, 129, 0.2)",
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 900,
              color: COLORS.hand,
              textTransform: "uppercase",
              letterSpacing: "1px",
            }}
          >
            CURRENTLY MADE (TOTAL)
          </Typography>
        </Box>
        <Grid container spacing={1}>
          <Grid size={{ xs: 3 }}>
            <DashboardCard
              name="Gross"
              amount={currentlyMadeTotals.gross}
              color={COLORS.gross}
            />
          </Grid>
          <Grid size={{ xs: 3 }}>
            <DashboardCard
              name="Net"
              amount={currentlyMadeTotals.netBase}
              color={COLORS.net}
            />
          </Grid>
          <Grid size={{ xs: 3 }}>
            <DashboardCard
              name="Tax"
              amount={currentlyMadeTotals.savings}
              color={COLORS.tax}
            />
          </Grid>
          <Grid size={{ xs: 3 }}>
            <DashboardCard
              name="Take Home"
              amount={currentlyMadeTotals.remaining}
              color={COLORS.hand}
            />
          </Grid>
        </Grid>
      </Box>

      <Divider sx={{ opacity: 0.1, mb: 4 }} />
    </SummarySection>
  );
};
