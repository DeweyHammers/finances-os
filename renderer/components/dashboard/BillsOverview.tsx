"use client";

import { Box, Grid, Typography, Paper, Tooltip } from "@mui/material";
import { SummarySection } from "./SummarySection";
import { DashboardCard } from "./DashboardCard";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import {
  getPayPeriodsForMonth,
  getBillAllocationsForBill,
  monthKeyOf,
  BillSplitRecord,
  clampDayToMonth,
  PayPeriod,
} from "../../lib/pay-period-utils";

interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDate: number;
  withdrawalCycle: string;
  neverSplit?: boolean;
}

interface BillsOverviewProps {
  bills: Bill[];
  settings: any;
  viewYear?: number;
  viewMonth?: number;
  splits?: BillSplitRecord[];
}

interface AllocatedBill {
  bill: Bill;
  amountCents: number;
  isSplit: boolean;
  occDay: number;
  occInNextMonth: boolean;
  coord: number;
  /** Cumulative cents allocated toward this occurrence through this pay week
   * (sum of all splits for the same billId+occurrenceCoord with weekIndex ≤
   * this period). Lets a split card show "$99.43 of $156.38" progress. */
  cumulativeCents: number;
}

export const BillsOverview: React.FC<BillsOverviewProps> = ({
  bills,
  settings,
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
  const periods = getPayPeriodsForMonth(year, month, payWeekday, today, biWeekly);
  const monthKey = monthKeyOf(year, month);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const nextMonthAbbr = new Date(year, month + 1, 1).toLocaleString("default", {
    month: "short",
  });

  const getOrdinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  };

  // Each allocation carries its own occurrenceCoord — that's the coord of the
  // specific bill occurrence being funded. Derive display fields from THAT,
  // not from a bill-level "first occurrence" — otherwise the "Due Sep 5" text
  // would be wrong for a P5 row funding the Oct 5 occurrence.
  const dayFromCoord = (coord: number) =>
    coord > daysInMonth ? coord - daysInMonth : coord;

  const resolvePeriodBills = (period: PayPeriod): AllocatedBill[] => {
    const out: AllocatedBill[] = [];
    for (const b of bills) {
      const allocs = getBillAllocationsForBill(
        b.id,
        Number(b.dueDate),
        Number(b.amount) || 0,
        periods,
        monthKey,
        splits,
      );
      for (const a of allocs) {
        if (a.periodKey !== period.key) continue;
        const inNextMonth = a.occurrenceCoord > daysInMonth;
        // Cumulative through this pay week for THIS occurrence only —
        // splits for a different occurrence of the same bill don't count.
        const cumulativeCents = allocs
          .filter(
            (x) =>
              x.occurrenceCoord === a.occurrenceCoord &&
              x.weekIndex <= period.index,
          )
          .reduce((s, x) => s + x.amountCents, 0);
        out.push({
          bill: b,
          amountCents: a.amountCents,
          isSplit: a.isSplit,
          occDay: dayFromCoord(a.occurrenceCoord),
          occInNextMonth: inNextMonth,
          coord: a.occurrenceCoord,
          cumulativeCents,
        });
      }
    }
    return out.sort((a, b) => a.coord - b.coord);
  };

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
      (acc, x) => acc + x.amountCents / 100,
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
            {periodBills.map(({ bill, amountCents, isSplit, occDay, occInNextMonth, cumulativeCents }) => {
              const clampedDay = clampDayToMonth(occDay, year, month);
              // Only prefix the month abbreviation for NEXT-month (forward-
              // extended) occurrences — in the current view an in-month bill
              // reads more naturally as just "the 5th". A bill firing twice
              // in the view still disambiguates cleanly: "5th" vs "Sep 5th".
              const dateChunk = occInNextMonth
                ? `${nextMonthAbbr} ${occDay}${getOrdinal(occDay)}`
                : `${clampedDay}${getOrdinal(clampedDay)}`;
              const totalDollars = Number(bill.amount) || 0;
              const cumulativeDollars = cumulativeCents / 100;
              const totalCents = Math.round(totalDollars * 100);
              const fullySaved = cumulativeCents >= totalCents;
              // For splits, render two lines: the split/date header, then a
              // progress line. Two Box spans keep the amounts on their own
              // row so narrow 5-week cards don't wrap mid-word. When the
              // cumulative already matches the total (this is the final
              // slice), drop the redundant "Saved $X /" prefix.
              const subtitle = isSplit ? (
                <Box>
                  <Box component="span" sx={{ display: "block" }}>
                    Split · {dateChunk}
                  </Box>
                  <Box
                    component="span"
                    sx={{ display: "block", opacity: 0.85 }}
                  >
                    {fullySaved
                      ? `Total $${totalDollars.toFixed(2)}`
                      : `Saved $${cumulativeDollars.toFixed(2)} / Total $${totalDollars.toFixed(2)}`}
                  </Box>
                </Box>
              ) : (
                `Due ${dateChunk}`
              );
              return (
                <Box
                  key={`${bill.id}-${period.key}`}
                  sx={{ position: "relative" }}
                >
                  <DashboardCard
                    name={bill.name}
                    amount={amountCents / 100}
                    subtitle={subtitle}
                    color={period.color}
                  />
                  {isSplit && (
                    <Tooltip
                      title={`Auto-split across pay weeks · $${totalDollars.toFixed(2)} total`}
                      placement="top"
                      arrow
                    >
                      <Box
                        sx={{
                          position: "absolute",
                          top: 8,
                          right: 8,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          bgcolor: `${period.color}33`,
                          color: period.color,
                          pointerEvents: "auto",
                        }}
                      >
                        <CallSplitIcon sx={{ fontSize: 14 }} />
                      </Box>
                    </Tooltip>
                  )}
                </Box>
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
