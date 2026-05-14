"use client";

import { Box, Typography, TextField, Divider } from "@mui/material";
import { UseFormRegister } from "react-hook-form";

interface W2SectionProps {
  register: UseFormRegister<any>;
}

export const W2Section = ({ register }: W2SectionProps) => {
  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1, fontWeight: 800 }}>
        Income
      </Typography>
      <Typography variant="body2" sx={{ mb: 3, color: "text.secondary" }}>
        Your weekly take-home income for cash flow projections.
      </Typography>
      <Divider sx={{ mb: 4 }} />
      <TextField
        {...register("w2Amount", { valueAsNumber: true })}
        label="Weekly Amount"
        type="number"
        fullWidth
        helperText="Amount received each weekly pay period (Q1-Q4)."
      />
    </Box>
  );
};
