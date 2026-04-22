"use client";

import {
  Box,
  Typography,
  TextField,
  FormControlLabel,
  Divider,
} from "@mui/material";
import { UseFormRegister } from "react-hook-form";
import { AppSwitch } from "../AppSwitch";

interface W2SectionProps {
  register: UseFormRegister<any>;
  w2Active: boolean;
  paymentCycle: string;
  onToggleChange: (name: string, checked: boolean) => void;
}

export const W2Section = ({
  register,
  w2Active,
  paymentCycle,
  onToggleChange,
}: W2SectionProps) => {
  const getHelperText = () => {
    if (paymentCycle === "WEEKLY")
      return "This amount will be applied to all 4 weekly segments (Q1-Q4).";
    if (paymentCycle === "BI_WEEKLY")
      return "This amount will be applied to both bi-weekly segments (Q1, Q2).";
    return "This amount will be applied to the full monthly calculation.";
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1, fontWeight: 800 }}>
        W2
      </Typography>
      <Typography variant="body2" sx={{ mb: 3, color: "text.secondary" }}>
        Estimated income from W2 sources for quarterly projections.
      </Typography>
      <Divider sx={{ mb: 4 }} />
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <FormControlLabel
          labelPlacement="start"
          control={
            <AppSwitch
              checked={!!w2Active}
              onChange={(e) => onToggleChange("w2Active", e.target.checked)}
            />
          }
          label={
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1">Active Status</Typography>
              <Typography variant="body2" color="text.secondary">
                Include W2 income in your financial overview.
              </Typography>
            </Box>
          }
          sx={{
            display: "flex",
            justifyContent: "space-between",
            width: "100%",
            ml: 0,
            mb: 1,
          }}
        />
        <Box sx={{ display: "flex", gap: 3 }}>
          <TextField
            {...register("w2Amount", { valueAsNumber: true })}
            label="Estimated Amount"
            type="number"
            fullWidth
            disabled={!w2Active}
            sx={{ flex: 1 }}
            helperText={getHelperText()}
          />
        </Box>
      </Box>
    </Box>
  );
};
