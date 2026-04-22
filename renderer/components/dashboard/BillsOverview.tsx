"use client";

import { Box, Grid, Chip, Typography, Paper } from "@mui/material";
import { SummarySection } from "./SummarySection";
import { DashboardCard } from "./DashboardCard";
import { getCycleColor, getCyclesForPaymentCycle } from "../../lib/cycle-utils";

interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDate: number;
  withdrawalCycle: string;
}

interface BillsOverviewProps {
  bills: Bill[];
  settings: any;
}

export const BillsOverview: React.FC<BillsOverviewProps> = ({
  bills,
  settings,
}) => {
  if (!settings) return null;
  const paymentCycle = settings.paymentCycle || "BI_WEEKLY";
  const cycles = getCyclesForPaymentCycle(paymentCycle);

  const getOrdinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  };

  const totalFullBills = bills.reduce(
    (acc, curr) => acc + (Number(curr.amount) || 0),
    0,
  );

  const renderCycle = (cycle: string) => {
    const cycleBills = bills.filter((b) =>
      paymentCycle === "MONTHLY" ? true : b.withdrawalCycle === cycle,
    );
    if (cycleBills.length === 0) return null;

    const subtotal = cycleBills.reduce(
      (acc, curr) => acc + (Number(curr.amount) || 0),
      0,
    );
    const cycleColor = getCycleColor(cycle);

    return (
      <Grid
        key={cycle}
        size={{ xs: 12, sm: cycles.length > 2 ? 6 : 12 / cycles.length }}
      >
        <Box sx={{ mb: 4, textAlign: "center" }}>
          <Chip
            label={cycle === "MONTH" ? "FULL MONTH" : `${cycle} CYCLE`}
            sx={{
              borderRadius: 1.5,
              fontSize: "0.75rem",
              fontWeight: 900,
              bgcolor: `${cycleColor}25`,
              color: cycleColor,
              height: 32,
              px: 2,
              mb: 2,
            }}
          />
          <Box
            sx={{
              py: 1.5,
              borderRadius: 2,
              bgcolor: `${cycleColor}10`,
              border: `1px solid ${cycleColor}25`,
              mb: 2,
            }}
          >
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                fontSize: "0.7rem",
                display: "block",
                fontWeight: 800,
                letterSpacing: "1px",
              }}
            >
              SUBTOTAL
            </Typography>
            <Typography
              variant="h5"
              sx={{ fontWeight: 900, color: cycleColor }}
            >
              ${subtotal.toFixed(2)}
            </Typography>
          </Box>
          {cycleBills.map((bill) => (
            <DashboardCard
              key={bill.id}
              name={bill.name}
              amount={bill.amount}
              subtitle={`Due on the ${bill.dueDate}${getOrdinal(bill.dueDate)}`}
              color={cycleColor}
            />
          ))}
        </Box>
      </Grid>
    );
  };

  return (
    <SummarySection
      title="Bills Overview"
      totalLabel="FULL MONTHLY TOTAL"
      totalAmount={totalFullBills}
    >
      <Grid container spacing={4}>
        {bills.length > 0 ? (
          cycles.map((cycle) => renderCycle(cycle))
        ) : (
          <Grid size={{ xs: 12 }}>
            <Paper
              variant="outlined"
              sx={{
                py: 4,
                textAlign: "center",
                bgcolor: "rgba(255,255,255,0.02)",
                borderStyle: "dashed",
              }}
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontStyle: "italic", fontWeight: 600 }}
              >
                No bills recorded
              </Typography>
            </Paper>
          </Grid>
        )}
      </Grid>
    </SummarySection>
  );
};
