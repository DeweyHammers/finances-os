"use client";

import { FC, useMemo } from "react";
import { Grid, Box, Typography } from "@mui/material";
import { SummarySection } from "../../dashboard/SummarySection";
import { DashboardCard } from "../../dashboard/DashboardCard";
import { COLORS } from "../../../lib/constants";

interface SummaryCardsProps {
  contract: any;
  entries: any[];
  settings?: any;
}

export const SummaryCards: FC<SummaryCardsProps> = ({
  contract,
  entries,
  settings,
}) => {
  const taxRate = Number(settings?.upworkTaxProvisionPercent) || 0;

  const totals = useMemo(() => {
    const gross = entries.reduce((acc, e) => acc + (e.grossPay || 0), 0);
    const netBase = entries.reduce((acc, e) => acc + (e.netPay || 0), 0);
    const savings = netBase * taxRate;
    const remaining = netBase - savings;

    return { gross, netBase, savings, remaining };
  }, [entries, taxRate]);

  const stats = useMemo(() => {
    if (!contract) return null;

    const grossRate = Number(contract.grossRate) || 0;
    const netRate = Number(contract.netRate) || 0;

    if (contract.type === "FIXED") {
      const gross = grossRate;
      const netBase = netRate;
      const savings = netBase * taxRate;
      const takeHome = netBase - savings;

      return {
        type: "FIXED",
        total: { gross, netBase, savings, takeHome },
        remaining: {
          gross: Math.max(0, gross - totals.gross),
          netBase: Math.max(0, netBase - totals.netBase),
          takeHome: Math.max(0, takeHome - totals.remaining),
        },
      };
    }

    const weeklyHours = Number(contract.weeklyHours) || 0;

    const calculate = (multiplier: number) => {
      const gross = weeklyHours * grossRate * multiplier;
      const netBase = weeklyHours * netRate * multiplier;
      const savings = netBase * taxRate;
      const takeHome = netBase - savings;

      return { gross, netBase, savings, takeHome };
    };

    return {
      type: "HOURLY",
      weekly: calculate(1),
      biWeekly: calculate(2),
      monthly: calculate(4),
    };
  }, [contract, taxRate, totals]);

  const StatBlock = ({
    title,
    data,
    color = "primary.light",
  }: {
    title: string;
    data: any;
    color?: string;
  }) => (
    <Box sx={{ height: "100%" }}>
      <Box
        sx={{
          mb: 1.5,
          px: 1,
          borderBottom: `1px solid ${color === "primary.light" ? "rgba(129, 140, 248, 0.2)" : "rgba(255, 255, 255, 0.1)"}`,
        }}
      >
        <Typography
          variant="subtitle2"
          sx={{
            fontWeight: 900,
            color: color,
            textTransform: "uppercase",
            letterSpacing: "1px",
            fontSize: "0.7rem",
          }}
        >
          {title}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <DashboardCard name="Gross" amount={data.gross} color={COLORS.gross} />
        <DashboardCard name="Net" amount={data.netBase} color={COLORS.hand} />
        <DashboardCard
          name="Savings"
          amount={data.savings || data.netBase * taxRate}
          color={COLORS.tax}
        />
        <DashboardCard
          name="Take Home"
          amount={data.takeHome}
          color="#34d399"
        />
      </Box>
    </Box>
  );

  return (
    <Box sx={{ mb: 4 }}>
      <Grid container spacing={4} sx={{ alignItems: "stretch" }}>
        {/* Currently Made Section - LEFT */}
        <Grid size={{ xs: 12, lg: 6 }}>
          <SummarySection
            title="Currently Made (Total)"
            sx={{ height: "100%", display: "flex", flexDirection: "column" }}
          >
            <Box
              sx={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 1,
              }}
            >
              <DashboardCard
                name="Total Gross"
                amount={totals.gross}
                color={COLORS.gross}
              />
              <DashboardCard
                name="Total Net (Base)"
                amount={totals.netBase}
                color={COLORS.hand}
              />
              <DashboardCard
                name="Total Tax Savings"
                amount={totals.savings}
                subtitle={`${(taxRate * 100).toFixed(0)}% of Net`}
                color={COLORS.tax}
              />
              <DashboardCard
                name="Remaining (Total Net)"
                amount={totals.remaining}
                color="#34d399"
              />
            </Box>
          </SummarySection>
        </Grid>

        {/* Potential Earnings Section - RIGHT */}
        <Grid size={{ xs: 12, lg: 6 }}>
          <SummarySection
            title={
              contract?.type === "FIXED"
                ? "Contract Value & Balance"
                : `Potential Earnings (${contract?.weeklyHours || 0} hrs/week)`
            }
            sx={{ height: "100%" }}
          >
            {stats?.type === "HOURLY" ? (
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 4 }}>
                  <StatBlock title="Weekly" data={stats.weekly} />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <StatBlock title="Bi-Weekly" data={stats.biWeekly} />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <StatBlock title="Monthly" data={stats.monthly} />
                </Grid>
              </Grid>
            ) : stats?.type === "FIXED" ? (
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <StatBlock
                    title="Total Contract Value"
                    data={stats.total}
                    color="success.light"
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <StatBlock
                    title="Remaining Balance"
                    data={stats.remaining}
                    color="warning.light"
                  />
                </Grid>
              </Grid>
            ) : (
              <Box sx={{ p: 4, textAlign: "center" }}>
                <Typography
                  variant="h6"
                  sx={{ color: "text.disabled", fontWeight: 700 }}
                >
                  Missing Contract Data
                </Typography>
              </Box>
            )}
          </SummarySection>
        </Grid>
      </Grid>
    </Box>
  );
};
