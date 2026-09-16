"use client";

/**
 * BillsOverview — pay-week breakdown of bill obligations for the Overview page.
 *
 * Renders one card per bill occurrence per pay week, driven by the split
 * allocations persisted in `BillSplit` (see `pay-period-utils`). A single
 * monthly bill can appear more than once in a view (in-month firing plus a
 * forward-extended next-month firing), so allocations are keyed by
 * `(billId, occurrenceCoord)` — never by billId alone. Split bills show
 * "Saved X / Total Y" progress accumulated ONLY across splits for the same
 * occurrence, so a Sep 4 Starlink split doesn't inflate the Oct 4 card.
 *
 * Read-only presenter: mutations happen in the Overview optimizer which
 * writes BillSplit rows this component then reads. Props: `bills` (raw list),
 * `settings` (payday / cycle), `viewYear`/`viewMonth` (period target),
 * `splits` (persisted BillSplit rows for this month).
 */

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
import { getOrdinal } from "../../lib/date-utils";
import {
  TooltipBody,
  TooltipTitle,
  tooltipStyleProps,
} from "../../lib/tooltip-styles";

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

  // ── Derive view context (payday cadence, pay periods, month keys) ──
  // Default payWeekday=2 (Tue) matches historical setup; overriding via
  // settings.payDay avoids hardcoding a personal preference.
  const payWeekday: number =
    settings.payDay != null ? Number(settings.payDay) : 2;
  const biWeekly = settings.paymentCycle === "BI_WEEKLY";

  const today = new Date();
  const year = viewYear ?? today.getFullYear();
  const month = viewMonth ?? today.getMonth();
  const periods = getPayPeriodsForMonth(year, month, payWeekday, today, biWeekly);
  const monthKey = monthKeyOf(year, month);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Used only for labeling next-month (forward-extended) occurrences —
  // e.g. an Oct 4 Starlink firing displayed on a September view card.
  const nextMonthAbbr = new Date(year, month + 1, 1).toLocaleString("default", {
    month: "short",
  });

  // Each allocation carries its own occurrenceCoord — that's the coord of the
  // specific bill occurrence being funded. Derive display fields from THAT,
  // not from a bill-level "first occurrence" — otherwise the "Due Sep 5" text
  // would be wrong for a P5 row funding the Oct 5 occurrence.
  // Occurrence coords > daysInMonth encode next-month firings (e.g. coord=34
  // in a 30-day September ⇒ Oct 4). Subtract to recover the display day.
  const dayFromCoord = (coord: number) =>
    coord > daysInMonth ? coord - daysInMonth : coord;

  // ── Per-period allocation resolver ──
  // Fans a bill's allocations (possibly multiple: split + multi-occurrence)
  // out into flat AllocatedBill rows for a single pay period. The heavy
  // lifting (which pay week each split slice belongs to) is in
  // pay-period-utils; here we just filter by periodKey and compute display
  // fields (occurrence day, cumulative saved).
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
    // Sort by coord so earlier-in-month occurrences render above later ones,
    // which visually mirrors the pay-week timeline (Sep 4 above Oct 4).
    return out.sort((a, b) => a.coord - b.coord);
  };

  // Only pay weeks with at least one bill contribute to the responsive
  // grid width calc below (empty pay weeks still render null / a null Grid).
  const activePeriods = periods.filter(
    (p) => resolvePeriodBills(p).length > 0,
  );

  const renderPeriod = (period: PayPeriod) => {
    const periodBills = resolvePeriodBills(period);

    if (periodBills.length === 0) return null;

    const subtotal = periodBills.reduce(
      (acc, x) => acc + x.amountCents / 100,
      0,
    );

    return (
      // Responsive grid: xs=full row, sm=half when >1 active period, md=split
      // evenly across active periods. Using activePeriods (not periods) so
      // empty pay weeks don't steal column width from populated ones.
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
              // First-slice cards have cumulative === this-week's slice — the
              // card's headline amount already IS the saved number, so a
              // "Saved $X" line would just repeat it. On non-first slices the
              // "Saved" tally is useful because it reflects cumulative across
              // earlier weeks. The bill's TOTAL is shown in the CallSplit
              // badge tooltip, so we don't need a Total line on the card face.
              const isFirstSlice = cumulativeCents === amountCents;
              const subtitle = isSplit ? (
                <Box>
                  <Box component="span" sx={{ display: "block" }}>
                    Split · {dateChunk}
                  </Box>
                  {!isFirstSlice && (
                    <Box
                      component="span"
                      sx={{ display: "block", opacity: 0.85 }}
                    >
                      Saved ${cumulativeDollars.toFixed(2)}
                    </Box>
                  )}
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
                      placement="top"
                      arrow
                      {...tooltipStyleProps(period.color)}
                      title={
                        <>
                          <TooltipTitle color={period.color}>
                            Split across pay weeks
                          </TooltipTitle>
                          <TooltipBody>
                            Total ${totalDollars.toFixed(2)} auto-balanced across this month's pay weeks.
                          </TooltipBody>
                        </>
                      }
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
      iconAccent="#f43f5e"
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
