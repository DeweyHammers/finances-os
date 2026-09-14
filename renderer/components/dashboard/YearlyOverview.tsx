"use client";

/**
 * YearlyOverview — annual (non-monthly) costs grouped by calendar month.
 *
 * Renders YearlyCost records (things like annual insurance, subscriptions
 * renewing once/year) grouped by their `month` field, each group sorted
 * chronologically. Pink accent (#ec4899) distinguishes yearly items from
 * monthly bills / personal in the Overview.
 *
 * Read-only. Props: `yearlyCosts` (raw list) and `months` (localized month
 * names supplied by the parent — makes it locale-swappable without
 * duplicating month arrays here).
 */

import { Box, Typography, Paper } from "@mui/material";
import { SummarySection } from "./SummarySection";
import { DashboardCard } from "./DashboardCard";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";

interface YearlyCost {
  id: string;
  name: string;
  amount: number;
  month: number;
  day: number;
}

interface YearlyOverviewProps {
  yearlyCosts: YearlyCost[];
  months: string[];
}

export const YearlyOverview: React.FC<YearlyOverviewProps> = ({
  yearlyCosts,
  months,
}) => {
  // Group yearly costs by month number, then sort chronologically
  // Two-step so numeric ordering happens BEFORE the number→name conversion —
  // sorting month name strings alphabetically ("April" before "January")
  // would be wrong. `cost.month` is 1-indexed; `months` array is 0-indexed.
  const groupedByMonthNum = yearlyCosts.reduce((acc: any, cost: any) => {
    const m = cost.month;
    if (!acc[m]) acc[m] = { costs: [], total: 0 };
    acc[m].costs.push(cost);
    acc[m].total += Number(cost.amount) || 0;
    return acc;
  }, {});
  const groupedYearly = Object.fromEntries(
    Object.entries(groupedByMonthNum)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([m, data]) => [months[Number(m) - 1], data]),
  );

  const yearlyTotal = yearlyCosts.reduce(
    (acc, curr) => acc + (Number(curr.amount) || 0),
    0,
  );

  return (
    <SummarySection
      title="Yearly Costs"
      icon={<CalendarMonthIcon />}
    >
      <Box sx={{ width: "100%" }}>
        {Object.keys(groupedYearly).length > 0 ? (
          Object.entries(groupedYearly).map(
            ([monthName, data]: [string, any]) => (
              <Box key={monthName} sx={{ mb: 3 }}>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    mb: 1.5,
                    px: 1,
                    borderBottom: "1px solid rgba(236, 72, 153, 0.2)",
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 900,
                      color: "#ec4899",
                      textTransform: "uppercase",
                      letterSpacing: "1.5px",
                    }}
                  >
                    {monthName}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 800, color: "text.secondary" }}
                  >
                    TOTAL:{" "}
                    <span style={{ color: "white" }}>
                      ${data.total.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </Typography>
                </Box>
                <Box
                  sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}
                >
                  {data.costs.map((cost: any) => (
                    <DashboardCard
                      key={cost.id}
                      name={cost.name}
                      amount={cost.amount}
                      subtitle={`${monthName} ${cost.day}`}
                      color="#ec4899"
                    />
                  ))}
                </Box>
              </Box>
            ),
          )
        ) : (
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
              No yearly costs recorded
            </Typography>
          </Paper>
        )}
      </Box>
    </SummarySection>
  );
};
