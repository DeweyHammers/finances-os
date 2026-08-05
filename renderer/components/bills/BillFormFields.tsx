"use client";

import { TextField, Grid } from "@mui/material";
import { UseFormReturn } from "react-hook-form";

interface BillFormFieldsProps {
  formProps: UseFormReturn<any>;
}

export const BillFormFields = ({ formProps }: BillFormFieldsProps) => {
  const {
    register,
    formState: { errors },
  } = formProps;

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12 }}>
        <TextField
          {...register("name", { required: "Required" })}
          label="Bill Name"
          fullWidth
          variant="outlined"
          slotProps={{ inputLabel: { shrink: true } }}
          error={!!errors.name}
          helperText={errors.name?.message as any}
        />
      </Grid>
      <Grid size={{ xs: 12 }}>
        <TextField
          {...register("amount", {
            required: "Required",
            valueAsNumber: true,
          })}
          label="Amount"
          type="number"
          fullWidth
          variant="outlined"
          slotProps={{ inputLabel: { shrink: true } }}
          error={!!errors.amount}
          helperText={errors.amount?.message as any}
        />
      </Grid>
      <Grid size={{ xs: 12 }}>
        <TextField
          {...register("dueDate", {
            required: "Required",
            valueAsNumber: true,
            min: 1,
            max: 31,
          })}
          label="Due Day (1-31)"
          type="number"
          fullWidth
          variant="outlined"
          slotProps={{ inputLabel: { shrink: true } }}
          error={!!errors.dueDate}
          helperText={errors.dueDate?.message as any}
        />
      </Grid>
    </Grid>
  );
};
