"use client";

import { FC, useEffect } from "react";
import { Paper, Typography, Grid, TextField, Button, Box } from "@mui/material";
import { Controller, UseFormReturn } from "react-hook-form";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { isSaturday } from "date-fns";

interface EntryFormProps {
  formProps: UseFormReturn<any>;
  onSubmit: (data: any) => void;
  title: string;
  buttonText: string;
  contract: any;
  noPaper?: boolean;
  hideButton?: boolean;
}

export const EntryForm: FC<EntryFormProps> = ({
  formProps,
  onSubmit,
  title,
  buttonText,
  contract,
  noPaper = false,
  hideButton = false,
}) => {
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isValid },
  } = formProps;

  const watchedHours = watch("hours");
  const watchedGross = watch("grossPay");
  const isHourly = contract?.type === "HOURLY";
  const feePercent = contract?.feePercent || 0;

  // 1. Auto-calculate Gross if Hourly
  useEffect(() => {
    if (isHourly && contract && watchedHours !== undefined) {
      const gross = (watchedHours || 0) * (contract.grossRate || 0);
      setValue("grossPay", Number(gross.toFixed(2)));
    }
  }, [watchedHours, contract, setValue, isHourly]);

  // 2. Auto-calculate Net from Gross (Always)
  useEffect(() => {
    const gross = Number(watchedGross) || 0;
    const net = gross * (1 - feePercent / 100);
    setValue("netPay", Number(net.toFixed(2)));
  }, [watchedGross, feePercent, setValue]);

  const shouldDisableDate = (date: Date) => {
    return !isSaturday(date);
  };

  const formContent = (
    <Box>
      {title && (
        <Typography
          variant="h6"
          sx={{ mb: 3, fontWeight: 700, color: "primary.main" }}
        >
          {title}
        </Typography>
      )}
      <form onSubmit={handleSubmit(onSubmit)}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12 }}>
            <Controller
              name="date"
              control={control}
              render={({ field }) => (
                <DatePicker
                  {...field}
                  label="Week Ending (Saturday)"
                  shouldDisableDate={shouldDisableDate}
                  slotProps={{
                    textField: {
                      fullWidth: true,
                      error: !!errors.date,
                      helperText: errors.date?.message as string,
                    },
                  }}
                />
              )}
            />
          </Grid>

          {isHourly && (
            <Grid size={{ xs: 12 }}>
              <TextField
                {...register("hours", { valueAsNumber: true })}
                label="Hours Worked"
                type="number"
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
          )}

          <Grid size={{ xs: 12 }}>
            <TextField
              {...register("grossPay", { valueAsNumber: true })}
              label="Gross Pay"
              type="number"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Grid>

          <Grid size={{ xs: 12 }}>
            <TextField
              {...register("netPay", { valueAsNumber: true })}
              label="Net Pay"
              type="number"
              fullWidth
              disabled
              variant="outlined"
              slotProps={{ inputLabel: { shrink: true } }}
              helperText={`Auto-calculated (${feePercent}% fee)`}
            />
          </Grid>

          {!hideButton && (
            <Grid size={{ xs: 12 }}>
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={!isValid}
                sx={{ mt: 1, py: 1.5, fontWeight: 800 }}
              >
                {buttonText}
              </Button>
            </Grid>
          )}
        </Grid>
      </form>
    </Box>
  );

  if (noPaper) {
    return formContent;
  }

  return (
    <Paper
      sx={{
        p: 3,
        bgcolor: "background.paper",
        borderRadius: 2,
        border: "1px solid rgba(129, 140, 248, 0.2)",
      }}
    >
      {formContent}
    </Paper>
  );
};
