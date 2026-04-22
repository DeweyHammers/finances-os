"use client";

import { FC } from "react";
import { TextField, Grid, Box } from "@mui/material";
import { Controller, UseFormReturn } from "react-hook-form";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { parseISOAsLocal } from "../../lib/date-utils";

interface EddPaymentFormFieldsProps {
  formProps: UseFormReturn<any>;
}

export const EddPaymentFormFields: FC<EddPaymentFormFieldsProps> = ({
  formProps,
}) => {
  const {
    register,
    control,
    formState: { errors },
  } = formProps;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3, mt: 2 }}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12 }}>
          <Controller
            control={control}
            name="date"
            defaultValue={new Date()}
            render={({ field }) => (
              <DatePicker
                {...field}
                value={parseISOAsLocal(field.value)}
                onChange={(date) => field.onChange(date)}
                label="Payment Date"
                slotProps={{
                  textField: {
                    fullWidth: true,
                    variant: "outlined",
                    error: !!errors.date,
                    helperText: errors.date?.message as any,
                  },
                }}
              />
            )}
          />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <TextField
            {...register("amount", {
              required: "Required",
              valueAsNumber: true,
            })}
            label="Payment Amount"
            type="number"
            fullWidth
            variant="outlined"
            slotProps={{ inputLabel: { shrink: true } }}
            error={!!errors.amount}
            helperText={errors.amount?.message as any}
          />
        </Grid>
      </Grid>
    </Box>
  );
};
