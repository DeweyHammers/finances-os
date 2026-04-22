import { Paper, Typography, TextField, InputAdornment } from "@mui/material";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";

interface GapFillerSectionProps {
  avgFixedJobValue: number | "";
  handleNumChange: (
    setter: (val: number | "") => void,
  ) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  setAvgFixedJobValue: (val: number | "") => void;
}

export default function GapFillerSection({
  avgFixedJobValue,
  handleNumChange,
  setAvgFixedJobValue,
}: GapFillerSectionProps) {
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
        <AccountBalanceWalletIcon fontSize="small" /> Income Gap Filler
      </Typography>
      <TextField
        label="Avg Fixed Job Value (Gross)"
        type="number"
        fullWidth
        value={avgFixedJobValue}
        onChange={handleNumChange(setAvgFixedJobValue)}
        slotProps={{
          input: {
            startAdornment: <InputAdornment position="start">$</InputAdornment>,
          },
        }}
        helperText="How much do you typically charge for a fixed-price project?"
      />
    </Paper>
  );
}
