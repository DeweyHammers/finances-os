"use client";

import { useEffect } from "react";
import {
  TextField,
  MenuItem,
  CircularProgress,
  Box,
  Grid,
} from "@mui/material";
import { UseFormReturn } from "react-hook-form";
import { usePaymentCycle } from "../../lib/usePaymentCycle";

interface PersonalFormFieldsProps {
  formProps: UseFormReturn<any>;
  isEdit?: boolean;
}

export const PersonalFormFields = ({
  formProps,
  isEdit = false,
}: PersonalFormFieldsProps) => {
  const {
    register,
    formState: { errors },
    setValue,
    watch,
  } = formProps;

  const { options, isLoading } = usePaymentCycle();

  // Set default value once options are loaded for Create
  useEffect(() => {
    if (!isEdit && !isLoading && options.length > 0) {
      const currentVal = watch("withdrawalCycle");
      if (!currentVal) {
        setValue("withdrawalCycle", options[0].value);
      }
    }
  }, [isLoading, options, setValue, isEdit, watch]);

  const withdrawalCycleValue = watch("withdrawalCycle") || "";

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12 }}>
        <TextField
          {...register("name", { required: "Required" })}
          label="Personal Bill Name"
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
      <Grid size={{ xs: 12 }}>
        <TextField
          {...register("withdrawalCycle", { required: "Required" })}
          select
          label="Withdrawal Cycle"
          fullWidth
          variant="outlined"
          value={withdrawalCycleValue}
          slotProps={{ inputLabel: { shrink: true } }}
          error={!!errors.withdrawalCycle}
          helperText={errors.withdrawalCycle?.message as any}
        >
          {options.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>
      </Grid>
    </Grid>
  );
};
