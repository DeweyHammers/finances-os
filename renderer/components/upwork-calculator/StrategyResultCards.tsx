import { Grid, Paper, Typography } from "@mui/material";
import { COLORS } from "../../lib/constants";

interface StrategyResultCardsProps {
  calculations: any;
  formatCurrency: (val: number) => string;
}

export default function StrategyResultCards({
  calculations,
  formatCurrency,
}: StrategyResultCardsProps) {
  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, sm: 6 }}>
        <Paper
          sx={{
            p: 3,
            textAlign: "center",
            height: "100%",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              fontWeight: 800,
              letterSpacing: 1,
            }}
          >
            NEW JOBS TO WIN
          </Typography>
          <Typography
            variant="h3"
            sx={{ fontWeight: 900, my: 1, color: "primary.main" }}
          >
            {calculations ? calculations.totalJobsToWin : 0}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {calculations ? Math.ceil(calculations.fixedJobsNeeded) : 0} Fixed |{" "}
            {calculations?.unsecuredHourlyCount || 0} Hourly needed
          </Typography>
        </Paper>
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <Paper
          sx={{
            p: 3,
            textAlign: "center",
            height: "100%",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              fontWeight: 800,
              letterSpacing: 1,
            }}
          >
            BIDS REQUIRED / MONTH
          </Typography>
          <Typography
            variant="h3"
            sx={{ fontWeight: 900, my: 1, color: COLORS.tax }}
          >
            {calculations ? Math.ceil(calculations.bidsNeeded) : 0}
          </Typography>
        </Paper>
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <Paper
          sx={{
            p: 3,
            textAlign: "center",
            height: "100%",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              fontWeight: 800,
              letterSpacing: 1,
            }}
          >
            CONNECTS NEEDED
          </Typography>
          <Typography
            variant="h3"
            sx={{ fontWeight: 900, my: 1, color: "#f43f5e" }}
          >
            {calculations ? Math.ceil(calculations.totalConnectsNeeded) : 0}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            -100 Free |{" "}
            {calculations ? Math.ceil(calculations.billableConnects) : 0}{" "}
            Billable
          </Typography>
        </Paper>
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <Paper
          sx={{
            p: 3,
            textAlign: "center",
            height: "100%",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              fontWeight: 800,
              letterSpacing: 1,
            }}
          >
            WEEKLY REVENUE GOAL
          </Typography>
          <Typography
            variant="h3"
            sx={{ fontWeight: 900, my: 1, color: COLORS.hand }}
          >
            $
            {calculations
              ? formatCurrency(calculations.weeklyGrossTarget)
              : "0.00"}{" "}
          </Typography>
        </Paper>
      </Grid>
    </Grid>
  );
}
