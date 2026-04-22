import {
  Card,
  CardContent,
  Box,
  Typography,
  Divider,
  Grid,
} from "@mui/material";
import CalculateIcon from "@mui/icons-material/Calculate";

interface RevenueSummaryCardProps {
  data: any;
  formatCurrency: (val: number) => string;
}

export default function RevenueSummaryCard({
  data,
  formatCurrency,
}: RevenueSummaryCardProps) {
  return (
    <Card sx={{ bgcolor: "primary.main", color: "white", borderRadius: 2 }}>
      <CardContent sx={{ p: 4 }}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <Box>
            <Typography
              variant="overline"
              sx={{ fontWeight: 800, opacity: 0.8 }}
            >
              Monthly Revenue Target (Gross)
            </Typography>
            <Typography variant="h2" sx={{ fontWeight: 900 }}>
              ${data ? formatCurrency(data.gross) : "0.00"}
            </Typography>
          </Box>
          <CalculateIcon sx={{ fontSize: 60, opacity: 0.3 }} />
        </Box>
        <Divider sx={{ my: 2, borderColor: "rgba(255,255,255,0.2)" }} />
        <Grid container spacing={2}>
          <Grid size={{ xs: 4 }}>
            <Typography
              variant="caption"
              sx={{ opacity: 0.8, display: "block" }}
            >
              TAKE HOME
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              ${data ? formatCurrency(data.takeHome) : "0.00"}
            </Typography>
          </Grid>
          <Grid size={{ xs: 4 }}>
            <Typography
              variant="caption"
              sx={{ opacity: 0.8, display: "block" }}
            >
              TAXES ({(data?.taxRate || 0) * 100}%)
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              ${data ? formatCurrency(data.net * data.taxRate) : "0.00"}
            </Typography>
          </Grid>
          <Grid size={{ xs: 4 }}>
            <Typography
              variant="caption"
              sx={{ opacity: 0.8, display: "block" }}
            >
              RESERVES
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              ${data ? formatCurrency(data.monthlyExpenseHold) : "0.00"}
            </Typography>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}
