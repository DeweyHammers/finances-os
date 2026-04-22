import { Paper, Typography, Grid, TextField } from "@mui/material";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";

interface BiddingStrategySectionProps {
  winRate: number;
  setWinRate: (val: number) => void;
  connectsPerBid: number | "";
  handleNumChange: (
    setter: (val: number | "") => void,
  ) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  setConnectsPerBid: (val: number | "") => void;
}

export default function BiddingStrategySection({
  winRate,
  setWinRate,
  connectsPerBid,
  handleNumChange,
  setConnectsPerBid,
}: BiddingStrategySectionProps) {
  return (
    <Paper
      sx={{
        p: 3,
        borderRadius: 2,
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <Typography
        variant="h6"
        sx={{
          mb: 3,
          color: "primary.main",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <TrendingUpIcon fontSize="small" /> Bidding Strategy
      </Typography>
      <Grid container spacing={4}>
        <Grid size={{ xs: 12 }}>
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", mb: 1, display: "block" }}
          >
            Projected Win Rate: {winRate.toFixed(1)}%
          </Typography>
          <TextField
            type="range"
            fullWidth
            value={winRate}
            onChange={(e) => setWinRate(Number(e.target.value))}
            slotProps={{ htmlInput: { min: 0.5, max: 50, step: 0.5 } }}
          />
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", fontStyle: "italic" }}
          >
            (1 hire for every {winRate > 0 ? (100 / winRate).toFixed(1) : 0}{" "}
            bids)
          </Typography>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <TextField
            label="Connects Per Bid"
            type="number"
            fullWidth
            value={connectsPerBid}
            onChange={handleNumChange(setConnectsPerBid)}
            helperText="Average connects spent per proposal"
          />
        </Grid>
      </Grid>
    </Paper>
  );
}
