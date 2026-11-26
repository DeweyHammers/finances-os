"use client";

/**
 * BillFormFields — shared input set for Bill create + edit modals.
 *
 * Captures the four fields on the Bill schema: name (string), amount (dollars,
 * number), dueDate (1-31, day-of-month integer), and neverSplit (boolean flag
 * consumed by the pay-week balancer to force a bill into a single pay week).
 * Validation: name/amount/dueDate required; dueDate clamped 1..31.
 */

import { TextField, Grid, Switch } from "@mui/material";
import { UseFormReturn, Controller } from "react-hook-form";
import { FormSection } from "../shared/FormSection";

interface BillFormFieldsProps {
  formProps: UseFormReturn<any>;
}

export const BillFormFields = ({ formProps }: BillFormFieldsProps) => {
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
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { inputMode: "decimal" } }}
          error={!!errors.amount}
          helperText={errors.amount?.message as any}
        />
      </Grid>
      <Grid size={{ xs: 12 }}>
        {/*
          dueDate is a day-of-month integer (1..31), NOT a full date. The
          pay-period-utils layer clamps values > daysInMonth (e.g. 31 in Sept)
          so a bill "due the 31st" appears on the 30th when the month is short.
        */}
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
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { inputMode: "numeric" } }}
          error={!!errors.dueDate}
          helperText={errors.dueDate?.message as any}
        />
      </Grid>
      {/*
        neverSplit tells the pay-week balancer this bill must fund from a single
        pay week (no BillSplit rows will be created for it). Useful for bills
        that clear immediately on autopay and can't be smoothed across paychecks.

        One on / off choice = one card (shared/FormSection) with the switch at
        the right end, the same as "PRIMARY INCOME" in the Income form. It was
        a lone checkbox under the fields until Nov 25 2026.
      */}
      <Grid size={{ xs: 12 }}>
        <Controller
          name="neverSplit"
          control={control}
          defaultValue={false}
          render={({ field }) => (
            <FormSection
              title="NEVER SPLIT ACROSS PAY WEEKS"
              description="The whole bill is saved from one pay week instead of being spread over several paychecks."
              action={
                <Switch
                  checked={!!field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                  color="primary"
                  slotProps={{ input: { "aria-label": "Never split across pay weeks" } }}
                />
              }
            />
          )}
        />
      </Grid>
    </Grid>
  );
};
