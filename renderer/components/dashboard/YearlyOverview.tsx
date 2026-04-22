"use client";

import { Box, Typography, Paper } from "@mui/material";
import { SummarySection } from "./SummarySection";
import { DashboardCard } from "./DashboardCard";

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

  return (
    <SummarySection title="Yearly Overview">
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
                    mb: 1,
                    px: 1,
                    borderBottom: "1px solid rgba(236, 72, 153, 0.2)",
                  }}
                >
                  <Typography
                    variant="subtitle2"
                    sx={{
                      fontWeight: 900,
                      color: "#ec4899",
                      textTransform: "uppercase",
                      letterSpacing: "1px",
                    }}
                  >
                    {monthName}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 800, color: "text.secondary" }}
                  >
                    MONTH TOTAL: ${data.total.toFixed(2)}
                  </Typography>
                </Box>
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
            ),
          )
        ) : (
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
              No yearly costs recorded
            </Typography>
          </Paper>
        )}
      </Box>
    </SummarySection>
  );
};
