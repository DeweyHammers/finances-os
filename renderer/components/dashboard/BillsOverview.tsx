"use client";

import { Box, Grid, Chip, Typography, Paper } from "@mui/material";
import { SummarySection } from "./SummarySection";
import { DashboardCard } from "./DashboardCard";
import { getCycleColor, getCyclesForPaymentCycle } from "../../lib/cycle-utils";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";

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
  const cycles = getCyclesForPaymentCycle();
  const activeCycles = cycles.filter((cycle) =>
    bills.some((b) => b.withdrawalCycle === cycle),
  );

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
    const cycleBills = bills
      .filter((b) => b.withdrawalCycle === cycle)
      .sort((a, b) => (Number(a.dueDate) || 0) - (Number(b.dueDate) || 0));
    if (cycleBills.length === 0) return null;

    const subtotal = cycleBills.reduce(
      (acc, curr) => acc + (Number(curr.amount) || 0),
      0,
    );
    const cycleColor = getCycleColor(cycle);

    return (
      <Grid
        key={cycle}
        size={{
          xs: 12,
          sm: activeCycles.length > 1 ? 6 : 12,
          md: activeCycles.length > 0 ? 12 / activeCycles.length : 12,
        }}
      >
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <Chip
              label={`${cycle} CYCLE`}
              sx={{
                borderRadius: 1.5,
                fontSize: "0.65rem",
                fontWeight: 900,
                bgcolor: `${cycleColor}15`,
                color: cycleColor,
                height: 24,
                px: 1,
              }}
            />
            <Typography
              variant="caption"
              sx={{
                fontWeight: 800,
                color: "text.secondary",
                letterSpacing: 0.5,
              }}
            >
              SUBTOTAL:{" "}
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
        </Box>
      </Grid>
    );
  };

  return (
    <SummarySection
      title="Bills"
      icon={<ReceiptLongIcon />}
      totalLabel="Full Month Total"
      totalAmount={totalFullBills}
    >
      <Grid container spacing={3}>
        {bills.length > 0 ? (
          cycles.map((cycle) => renderCycle(cycle))
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
                No bills recorded
              </Typography>
            </Paper>
          </Grid>
        )}
      </Grid>
    </SummarySection>
  );
};
