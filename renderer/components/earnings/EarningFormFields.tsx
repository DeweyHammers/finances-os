"use client";

import { TextField, Box } from "@mui/material";
import { UseFormRegister } from "react-hook-form";

interface EarningFormFieldsProps {
  register: UseFormRegister<any>;
}

export const EarningFormFields = ({ register }: EarningFormFieldsProps) => {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3, mt: 1 }}>
      <TextField
        {...register("amount", { required: true, valueAsNumber: true })}
        label="Amount"
        type="number"
        fullWidth
        autoFocus
        slotProps={{ htmlInput: { step: 0.01 } }}
      />
      <TextField
        {...register("date", { required: true })}
        label="Date Received"
        type="date"
        fullWidth
        slotProps={{
          inputLabel: { shrink: true },
        }}
      />
      <TextField
        {...register("description")}
        label="Description (Optional)"
        fullWidth
        multiline
        rows={2}
      />
    </Box>
  );
};
