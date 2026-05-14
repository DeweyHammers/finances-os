"use client";

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
  // Group yearly costs by month
  const groupedYearly = yearlyCosts.reduce((acc: any, cost: any) => {
    const monthName = months[cost.month - 1];
    if (!acc[monthName]) acc[monthName] = { costs: [], total: 0 };
    acc[monthName].costs.push(cost);
    acc[monthName].total += Number(cost.amount) || 0;
    return acc;
  }, {});

  const yearlyTotal = yearlyCosts.reduce(
    (acc, curr) => acc + (Number(curr.amount) || 0),
    0,
  );

  return (
    <SummarySection
      title="Yearly Overview"
      icon={<CalendarMonthIcon />}
      totalLabel="Yearly Total"
      totalAmount={yearlyTotal}
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
                    TOTAL: $
                    {data.total.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
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
                  {data.costs.length > 1 && (
                    <DashboardCard
                      name="Total"
                      amount={data.total}
                      color="#ec4899"
                    />
                  )}
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
