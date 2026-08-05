"use client";

import { Box, Grid, Typography, Paper } from "@mui/material";
import { SummarySection } from "./SummarySection";
import { DashboardCard } from "./DashboardCard";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import {
  getPayPeriodsForMonth,
  getBillPeriodKeyWithOverride,
  monthKeyOf,
  BillOverrideRecord,
  clampDayToMonth,
  PayPeriod,
} from "../../lib/pay-period-utils";

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
  viewYear?: number;
  viewMonth?: number;
  overrides?: BillOverrideRecord[];
}

export const BillsOverview: React.FC<BillsOverviewProps> = ({
  bills,
  settings,
  viewYear,
  viewMonth,
  overrides = [],
}) => {
  if (!settings) return null;

  const payWeekday: number =
    settings.payDay != null ? Number(settings.payDay) : 2;
  const biWeekly = settings.paymentCycle === "BI_WEEKLY";

  const today = new Date();
  const year = viewYear ?? today.getFullYear();
  const month = viewMonth ?? today.getMonth();
  const periods = getPayPeriodsForMonth(year, month, payWeekday, today, biWeekly);
  const monthKey = monthKeyOf(year, month);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstStart = periods[0]?.startDay ?? 1;
  const lastEnd = periods[periods.length - 1]?.endDay ?? daysInMonth;
  const nextMonthAbbr = new Date(year, month + 1, 1).toLocaleString("default", {
    month: "short",
  });

  const getOrdinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  };

  // View-window occurrence for a bill: the coord (in day-of-month with
  // forward-extension) at which this bill fires inside this month's periods.
  // Independent of any override — the calendar date doesn't change when we
  // shift the funding week.
  const occForView = (
    dueDate: number,
  ): { coord: number; inNextMonth: boolean; day: number } | null => {
    const nextCoord = dueDate + daysInMonth;
    if (nextCoord >= firstStart && nextCoord <= lastEnd) {
      return { coord: nextCoord, inNextMonth: true, day: dueDate };
    }
    if (dueDate >= firstStart && dueDate <= lastEnd) {
      return { coord: dueDate, inNextMonth: false, day: dueDate };
    }
    return null;
  };

  const resolvePeriodBills = (period: PayPeriod) =>
    bills
      .map((b) => {
        const occ = occForView(Number(b.dueDate));
        const key = getBillPeriodKeyWithOverride(
          b.id,
          Number(b.dueDate),
          periods,
          monthKey,
          overrides,
        );
        return { bill: b, occ, key };
      })
      .filter(
        (x): x is { bill: Bill; occ: NonNullable<typeof x.occ>; key: string } =>
          x.occ !== null && x.key === period.key,
      )
      .sort((a, b) => a.occ.coord - b.occ.coord);

  const activePeriods = periods.filter(
    (p) => resolvePeriodBills(p).length > 0,
  );

  const totalFullBills = bills.reduce(
    (acc, curr) => acc + (Number(curr.amount) || 0),
    0,
  );

  const renderPeriod = (period: PayPeriod) => {
    const periodBills = resolvePeriodBills(period);

    if (periodBills.length === 0) return null;

    const subtotal = periodBills.reduce(
      (acc, { bill }) => acc + (Number(bill.amount) || 0),
      0,
    );

    return (
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
            bgcolor: period.isCurrent
              ? `${period.color}0a`
              : "transparent",
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
              sx={{
                fontWeight: 800,
                color: "text.secondary",
                letterSpacing: 0.5,
              }}
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
            {periodBills.map(({ bill, occ }) => {
              const clampedDay = clampDayToMonth(occ.day, year, month);
              const subtitle = occ.inNextMonth
                ? `Due ${nextMonthAbbr} ${occ.day}${getOrdinal(occ.day)}`
                : `Due on the ${clampedDay}${getOrdinal(clampedDay)}`;
              return (
                <DashboardCard
                  key={bill.id}
                  name={bill.name}
                  amount={bill.amount}
                  subtitle={subtitle}
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
      title="Bills"
      icon={<ReceiptLongIcon />}
      totalLabel="Bills Total"
      totalAmount={totalFullBills}
    >
      <Grid container spacing={3}>
        {bills.length > 0 ? (
          periods.map((p) => renderPeriod(p))
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
