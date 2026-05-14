"use client";

import { useEffect } from "react";
import { TextField, Grid } from "@mui/material";
import { UseFormReturn } from "react-hook-form";
import { fromCents } from "../../lib/cents";

interface AccountFormFieldsProps {
  formProps: UseFormReturn<any>;
  isEdit?: boolean;
  currentBalanceCents?: number;
}

export const AccountFormFields = ({
  formProps,
  isEdit = false,
  currentBalanceCents = 0,
}: AccountFormFieldsProps) => {
  const {
    register,
    formState: { errors },
    setValue,
    watch,
  } = formProps;

  const workingBalance = watch("workingBalance");

  useEffect(() => {
    if (isEdit && workingBalance == null) {
      setValue("workingBalance", fromCents(currentBalanceCents));
    }
  }, [isEdit, currentBalanceCents, setValue, workingBalance]);

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12 }}>
        <TextField
          {...register("name", { required: "Required" })}
          label="Account Nickname"
          fullWidth
          variant="outlined"
          slotProps={{ inputLabel: { shrink: true } }}
          error={!!errors.name}
          helperText={errors.name?.message as any}
        />
      </Grid>
      <Grid size={{ xs: 12 }}>
        <TextField
          {...register("notes")}
          label="Account Notes"
          fullWidth
          multiline
          minRows={2}
          variant="outlined"
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Grid>
      <Grid size={{ xs: 12 }}>
        <TextField
          {...register("workingBalance", {
            valueAsNumber: true,
            required: "Required",
          })}
          label="Working Balance"
          type="number"
          fullWidth
          variant="outlined"
          slotProps={{ inputLabel: { shrink: true } }}
          helperText={
            isEdit
              ? "An adjustment transaction will be created automatically if you change this amount."
              : "Starting balance for this account."
          }
          error={!!errors.workingBalance}
        />
      </Grid>
    </Grid>
  );
};
