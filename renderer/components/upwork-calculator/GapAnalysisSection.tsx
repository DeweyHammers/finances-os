import { Box, Typography, Paper, Grid, Divider } from "@mui/material";
import { COLORS } from "../../lib/constants";

interface GapAnalysisSectionProps {
  data: any;
  calculations: any;
  formatCurrency: (val: number) => string;
}

export default function GapAnalysisSection({
  data,
  calculations,
  formatCurrency,
}: GapAnalysisSectionProps) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Paper
        sx={{
          p: 3,
          borderRadius: 2,
          border: "1px solid rgba(255,255,255,0.05)",
          bgcolor: "rgba(0,0,0,0.2)",
        }}
      >
        <Typography
          variant="overline"
          sx={{ color: "text.secondary", fontWeight: 800 }}
        >
          Gap Analysis
        </Typography>
        <Grid container spacing={1} sx={{ mt: 1 }}>
          <Grid size={{ xs: 8 }}>Projected Hourly Gross:</Grid>
          <Grid size={{ xs: 4 }} sx={{ textAlign: "right" }}>
            $
            {calculations
              ? formatCurrency(calculations.hourlyGrossTotal)
              : "0.00"}
          </Grid>
          <Grid size={{ xs: 12 }}>
            <Divider sx={{ my: 1, borderColor: "rgba(255,255,255,0.05)" }} />
          </Grid>
          <Grid size={{ xs: 8 }}>
            <strong>Remaining Gap to Fill:</strong>
          </Grid>
          <Grid
            size={{ xs: 4 }}
            sx={{
              textAlign: "right",
              color:
                (calculations?.remainingGross || 0) > 0
                  ? "#f43f5e"
                  : COLORS.hand,
            }}
          >
            <strong>
              $
              {calculations
                ? formatCurrency(calculations.remainingGross)
                : "0.00"}
            </strong>
          </Grid>
        </Grid>
      </Paper>

      <Paper
        sx={{
          p: 3,
          borderRadius: 2,
          border: "1px solid rgba(255,255,255,0.05)",
          bgcolor: "rgba(0,0,0,0.1)",
        }}
      >
        <Typography
          variant="overline"
          sx={{ color: "text.secondary", fontWeight: 800 }}
        >
          Expense Reserve Coverage
        </Typography>
        <Grid container spacing={1} sx={{ mt: 1 }}>
          <Grid size={{ xs: 8 }}>Monthly Reserve (Hold):</Grid>
          <Grid size={{ xs: 4 }} sx={{ textAlign: "right" }}>
            ${data ? formatCurrency(data.monthlyExpenseHold) : "0.00"}
          </Grid>
          <Grid size={{ xs: 8 }}>Estimated Connects Cost:</Grid>
          <Grid size={{ xs: 4 }} sx={{ textAlign: "right", color: "#f43f5e" }}>
            -$
            {calculations ? formatCurrency(calculations.connectsCost) : "0.00"}
          </Grid>
          <Grid size={{ xs: 12 }}>
            <Divider sx={{ my: 1, borderColor: "rgba(255,255,255,0.05)" }} />
          </Grid>
          <Grid size={{ xs: 8 }}>
            <strong>Remaining Reserve:</strong>
          </Grid>
          <Grid
            size={{ xs: 4 }}
            sx={{
              textAlign: "right",
              color:
                (calculations?.reserveRemaining || 0) >= 0
                  ? COLORS.hand
                  : "#f43f5e",
            }}
          >
            <strong>
              $
              {calculations
                ? formatCurrency(calculations.reserveRemaining)
                : "0.00"}
            </strong>
          </Grid>
        </Grid>
      </Paper>
    </Box>
  );
}
