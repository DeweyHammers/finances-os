"use client";

import { TextField, Grid } from "@mui/material";
import { UseFormReturn } from "react-hook-form";

interface PayeeFormFieldsProps {
  formProps: UseFormReturn<any>;
}

export const PayeeFormFields = ({ formProps }: PayeeFormFieldsProps) => {
  const {
    register,
    formState: { errors },
  } = formProps;

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12 }}>
        <TextField
          {...register("name", { required: "Required" })}
          label="Payee Name"
          fullWidth
          variant="outlined"
          slotProps={{ inputLabel: { shrink: true } }}
          error={!!errors.name}
          helperText={errors.name?.message as any}
        />
      </Grid>
    </Grid>
  );
};
