"use client";

import { TextField, MenuItem, Grid } from "@mui/material";
import { Controller, UseFormReturn } from "react-hook-form";
import { MONTHS } from "../../lib/constants";

interface YearlyCostFormFieldsProps {
  formProps: UseFormReturn<any>;
}

export const YearlyCostFormFields = ({
  formProps,
}: YearlyCostFormFieldsProps) => {
  const {
    register,
    control,
    formState: { errors },
  } = formProps;

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12 }}>
        <TextField
          {...register("name", { required: "Required" })}
          label="Cost Name"
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
      <Grid size={{ xs: 6 }}>
        <Controller
          control={control}
          name="month"
          rules={{ required: "Required" }}
          defaultValue={1}
          render={({ field }) => (
            <TextField
              {...field}
              value={field.value ?? 1}
              select
              label="Month"
              fullWidth
              variant="outlined"
              slotProps={{ inputLabel: { shrink: true } }}
              error={!!errors.month}
              helperText={errors.month?.message as any}
            >
              {MONTHS.map((month, index) => (
                <MenuItem key={month} value={index + 1}>
                  {month}
                </MenuItem>
              ))}
            </TextField>
          )}
        />
      </Grid>
      <Grid size={{ xs: 6 }}>
        <TextField
          {...register("day", {
            required: "Required",
            valueAsNumber: true,
            min: { value: 1, message: "Min 1" },
            max: { value: 31, message: "Max 31" },
          })}
          label="Day"
          type="number"
          fullWidth
          variant="outlined"
          slotProps={{ inputLabel: { shrink: true } }}
          error={!!errors.day}
          helperText={errors.day?.message as any}
        />
      </Grid>
    </Grid>
  );
};
