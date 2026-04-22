"use client";

import { FC } from "react";
import { TextField, Grid, Box } from "@mui/material";
import { Controller, UseFormReturn } from "react-hook-form";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { parseISOAsLocal } from "../../lib/date-utils";

interface JobReportFormFieldsProps {
  formProps: UseFormReturn<any>;
}

export const JobReportFormFields: FC<JobReportFormFieldsProps> = ({
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
          <TextField
            {...register("employerName", {
              required: "Required",
            })}
            label="Employer Name"
            fullWidth
            variant="outlined"
            slotProps={{ inputLabel: { shrink: true } }}
            error={!!errors.employerName}
            helperText={errors.employerName?.message as any}
          />
        </Grid>
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
                label="Report Date"
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
      </Grid>
    </Box>
  );
};
