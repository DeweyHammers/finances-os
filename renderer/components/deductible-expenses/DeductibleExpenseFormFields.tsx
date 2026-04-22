"use client";

import { TextField, Box } from "@mui/material";
import { UseFormRegister } from "react-hook-form";

interface DeductibleExpenseFormFieldsProps {
  register: UseFormRegister<any>;
}

export const DeductibleExpenseFormFields = ({
  register,
}: DeductibleExpenseFormFieldsProps) => {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3, mt: 1 }}>
      <TextField
        {...register("amount", { required: true, valueAsNumber: true })}
        label="Expense Amount"
        type="number"
        fullWidth
        autoFocus
        slotProps={{ htmlInput: { step: 0.01 } }}
      />
      <TextField
        {...register("date", { required: true })}
        label="Date of Expense"
        type="date"
        fullWidth
        slotProps={{
          inputLabel: { shrink: true },
        }}
      />
      <TextField
        {...register("description")}
        label="Description (e.g., Connects, Software)"
        fullWidth
        multiline
        rows={2}
      />
    </Box>
  );
};
