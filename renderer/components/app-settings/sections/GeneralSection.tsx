"use client";

import {
  Box,
  Typography,
  MenuItem,
  TextField,
  Divider,
  Alert,
  AlertTitle,
} from "@mui/material";
import { UseFormRegister } from "react-hook-form";

interface GeneralSectionProps {
  register: UseFormRegister<any>;
  currentValue?: string;
  initialValue?: string;
}

export const GeneralSection = ({
  register,
  currentValue,
  initialValue,
}: GeneralSectionProps) => {
  const isChanging =
    currentValue && initialValue && currentValue !== initialValue;

  const getWarningMessage = () => {
    if (!isChanging) return "";

    if (currentValue === "MONTHLY") {
      return "Changing to Monthly will automatically move ALL records to the single Monthly cycle.";
    }
    if (currentValue === "WEEKLY" || currentValue === "BI_WEEKLY") {
      return `Changing to ${currentValue === "WEEKLY" ? "Weekly" : "Bi-Weekly"} will automatically move ALL records to Q1.`;
    }
    return "";
  };

  const warningMessage = getWarningMessage();

  const getHelperText = () => {
    if (currentValue === "WEEKLY")
      return "Allowance and bills will be split into 4 segments (Q1, Q2, Q3, Q4).";
    if (currentValue === "BI_WEEKLY")
      return "Allowance and bills will be split into 2 segments (Q1, Q2).";
    if (currentValue === "MONTHLY")
      return "Allowance and bills will be calculated for the full month as a single segment.";
    return "Select your payment frequency.";
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1, fontWeight: 800 }}>
        General
      </Typography>
      <Typography variant="body2" sx={{ mb: 3, color: "text.secondary" }}>
        Configure your global application preferences and payment cycles.
      </Typography>
      <Divider sx={{ mb: 4 }} />

      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <TextField
          {...register("paymentCycle")}
          select
          label="Payment Cycle"
          fullWidth
          value={currentValue || "BI_WEEKLY"}
          slotProps={{ inputLabel: { shrink: true } }}
          helperText={getHelperText()}
        >
          <MenuItem value="WEEKLY">Weekly (Q1, Q2, Q3, Q4)</MenuItem>
          <MenuItem value="BI_WEEKLY">Bi-Weekly (Q1, Q2)</MenuItem>
          <MenuItem value="MONTHLY">Monthly (Single Total)</MenuItem>
        </TextField>

        {warningMessage && (
          <Alert
            severity="warning"
            variant="outlined"
            sx={{ bgcolor: "rgba(255, 152, 0, 0.05)" }}
          >
            <AlertTitle sx={{ fontWeight: 800 }}>
              Data Migration Warning
            </AlertTitle>
            {warningMessage}
          </Alert>
        )}
      </Box>
    </Box>
  );
};
