import { FC } from "react";
import { Box, Grid } from "@mui/material";
import { SummarySection } from "./SummarySection";
import { DashboardCard } from "./DashboardCard";
import { COLORS } from "../../lib/constants";

interface EddStatusProps {
  settings: any;
  eddPayments: any[];
}

export const EddStatus: FC<EddStatusProps> = ({ settings, eddPayments }) => {
  if (!settings || !settings.eddActive) return null;

  const startingAmount = Number(settings.eddRemainingBalance) || 0;
  const paymentsTotal = eddPayments.reduce(
    (sum, p) => sum + (Number(p.amount) || 0),
    0,
  );

  const remainingEDDamount = startingAmount - paymentsTotal;
  const dailyRate = 900 / 14;
  const payoutDaysRemaining = remainingEDDamount / dailyRate;

  const sortedPayments = [...eddPayments].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  const lastPaymentDateRaw =
    sortedPayments.length > 0
      ? sortedPayments[0].date
      : new Date().toISOString();

  const lastPaymentDate = new Date(lastPaymentDateRaw);
  const endDate = new Date(
    lastPaymentDate.getTime() + payoutDaysRemaining * 24 * 60 * 60 * 1000,
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDateForDays = new Date(endDate);
  endDateForDays.setHours(0, 0, 0, 0);

  const timeDiff = endDateForDays.getTime() - today.getTime();
  const calendarDaysRemaining = Math.max(
    0,
    Math.ceil(timeDiff / (1000 * 60 * 60 * 24)),
  );
  const calendarMonthsRemaining = calendarDaysRemaining / 30.44;

  const eddColors = {
    remaining: COLORS.hand,
    payments: "#f43f5e", // Rose
    time: COLORS.tax,
  };

  return (
    <SummarySection
      title="EDD Hub Status"
      totalLabel="PROJECTED END DATE"
      customTotal={endDate.toLocaleDateString()}
    >
      <Box sx={{ mb: 4 }}>
        <Grid container spacing={2}>
          {/* Main Row: Remaining Balance and Total Payments */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <DashboardCard
              name="Remaining EDD Balance"
              amount={remainingEDDamount}
              color={eddColors.remaining}
              subtitle="Current Available Funds"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <DashboardCard
              name="Total Payments"
              amount={paymentsTotal}
              color={eddColors.payments}
              subtitle={`${eddPayments.length} Payments Received`}
            />
          </Grid>

          {/* Bottom Row: Timeline Grid */}
          <Grid size={{ xs: 6 }}>
            <DashboardCard
              name="Days Remaining"
              amount={calendarDaysRemaining}
              isCurrency={false}
              suffix=" Days"
              precision={0}
              color={eddColors.time}
            />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <DashboardCard
              name="Months Remaining"
              amount={calendarMonthsRemaining}
              isCurrency={false}
              suffix=" Months"
              precision={1}
              color={eddColors.time}
            />
          </Grid>
        </Grid>
      </Box>
    </SummarySection>
  );
};
