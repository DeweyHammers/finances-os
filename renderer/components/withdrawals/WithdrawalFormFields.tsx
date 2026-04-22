"use client";

import { TextField, Box } from "@mui/material";
import { UseFormRegister } from "react-hook-form";

interface WithdrawalFormFieldsProps {
  register: UseFormRegister<any>;
}

export const WithdrawalFormFields = ({
  register,
}: WithdrawalFormFieldsProps) => {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3, mt: 1 }}>
      <TextField
        {...register("amount", { required: true, valueAsNumber: true })}
        label="Withdrawal Amount"
        type="number"
        fullWidth
        autoFocus
        slotProps={{ htmlInput: { step: 0.01 } }}
      />
      <TextField
        {...register("date", { required: true })}
        label="Date Withdrawn"
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
