"use client";

import { Box, Typography, TextField, Divider } from "@mui/material";
import { UseFormRegister } from "react-hook-form";
import { usePaymentCycle } from "../../../lib/usePaymentCycle";

interface W2SectionProps {
  register: UseFormRegister<any>;
}

export const W2Section = ({ register }: W2SectionProps) => {
  const { paymentCycle, cycles } = usePaymentCycle();
  const isBiWeekly = paymentCycle === "BI_WEEKLY";
  const isMonthly = paymentCycle === "MONTHLY";

  const cadenceWord = isBiWeekly
    ? "bi-weekly"
    : isMonthly
      ? "monthly"
      : "weekly";
  const cadenceTitle = isBiWeekly
    ? "Bi-Weekly"
    : isMonthly
      ? "Monthly"
      : "Weekly";
  const cycleRange =
    cycles.length === 1 ? "Q1" : `${cycles[0]}-${cycles[cycles.length - 1]}`;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1, fontWeight: 800 }}>
        Income
      </Typography>
      <Typography variant="body2" sx={{ mb: 3, color: "text.secondary" }}>
        Your {cadenceWord} take-home income for cash flow projections.
      </Typography>
      <Divider sx={{ mb: 4 }} />
      <TextField
        {...register("w2Amount", { valueAsNumber: true })}
        label={`${cadenceTitle} Amount`}
        type="number"
        fullWidth
        helperText={`Amount received each ${cadenceWord} pay period (${cycleRange}).`}
      />
    </Box>
  );
};
