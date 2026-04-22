"use client";

import { FC, useEffect } from "react";
import {
  TextField,
  MenuItem,
  Grid,
  Typography,
  Divider,
  Box,
} from "@mui/material";
import { Controller, UseFormReturn } from "react-hook-form";
import { useSelect } from "@refinedev/core";

interface ContractFormFieldsProps {
  formProps: UseFormReturn<any>;
}

export const ContractFormFields: FC<ContractFormFieldsProps> = ({
  formProps,
}) => {
  const {
    register,
    control,
    watch,
    setValue,
    formState: { errors },
  } = formProps;

  const contractType = watch("type") || "HOURLY";
  const grossRate = watch("grossRate");
  const feePercent = watch("feePercent");

  // Auto-calculate Net Rate based on Gross and Fee %
  useEffect(() => {
    const gross = Number(grossRate) || 0;
    const fee = Number(feePercent) || 0;
    const net = gross * (1 - fee / 100);
    setValue("netRate", Number(net.toFixed(2)));
  }, [grossRate, feePercent, setValue]);

  const {
    query: { data: clientData },
  } = useSelect({
    resource: "Client",
  });

  const clientOptions =
    clientData?.data.map((item: any) => ({
      label: item.name,
      value: item.id,
    })) || [];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* Contract Info Section */}
      <Box>
        <Typography
          variant="subtitle2"
          sx={{
            mb: 1.5,
            fontWeight: 700,
            color: "primary.main",
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          General Info
        </Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              {...register("name", { required: "Required" })}
              label="Contract Name"
              fullWidth
              variant="outlined"
              slotProps={{ inputLabel: { shrink: true } }}
              error={!!errors.name}
              helperText={errors.name?.message as any}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Controller
              control={control}
              name="clientId"
              rules={{ required: "Required" }}
              render={({ field }) => (
                <TextField
                  {...field}
                  value={field.value ?? ""}
                  select
                  label="Client"
                  fullWidth
                  variant="outlined"
                  slotProps={{ inputLabel: { shrink: true } }}
                  error={!!errors.clientId}
                  helperText={errors.clientId?.message as any}
                >
                  {clientOptions.map(
                    (option: { label: string; value: string }) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ),
                  )}
                </TextField>
              )}
            />
          </Grid>
        </Grid>
      </Box>

      <Divider />

      {/* Rates Section */}
      <Box>
        <Typography
          variant="subtitle2"
          sx={{
            mb: 1.5,
            fontWeight: 700,
            color: "primary.main",
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          Financials
        </Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 3 }}>
            <Controller
              control={control}
              name="type"
              rules={{ required: "Required" }}
              defaultValue="HOURLY"
              render={({ field }) => (
                <TextField
                  {...field}
                  value={field.value ?? "HOURLY"}
                  select
                  label="Contract Type"
                  fullWidth
                  variant="outlined"
                  slotProps={{ inputLabel: { shrink: true } }}
                  error={!!errors.type}
                  helperText={errors.type?.message as any}
                >
                  <MenuItem value="HOURLY">Hourly</MenuItem>
                  <MenuItem value="FIXED">Fixed Price</MenuItem>
                </TextField>
              )}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField
              {...register("grossRate", {
                required: "Required",
                valueAsNumber: true,
              })}
              label={contractType === "HOURLY" ? "Gross Rate" : "Gross Total"}
              type="number"
              fullWidth
              variant="outlined"
              slotProps={{ inputLabel: { shrink: true } }}
              error={!!errors.grossRate}
              helperText={errors.grossRate?.message as any}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField
              {...register("feePercent", {
                required: "Required",
                valueAsNumber: true,
              })}
              label="Fee %"
              type="number"
              fullWidth
              variant="outlined"
              slotProps={{ inputLabel: { shrink: true } }}
              error={!!errors.feePercent}
              helperText="UpWork Cut %"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField
              {...register("netRate", {
                required: "Required",
                valueAsNumber: true,
              })}
              label="Net Rate"
              type="number"
              fullWidth
              variant="outlined"
              disabled
              slotProps={{ inputLabel: { shrink: true } }}
              error={!!errors.netRate}
              helperText="Auto-calculated"
            />
          </Grid>
        </Grid>
      </Box>

      <Divider />

      {/* Schedule/Hours Section */}
      {contractType === "HOURLY" && (
        <Box>
          <Typography
            variant="subtitle2"
            sx={{
              mb: 1.5,
              fontWeight: 700,
              color: "primary.main",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Projections
          </Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                control={control}
                name="startDate"
                render={({ field }) => (
                  <TextField
                    {...field}
                    value={
                      field.value
                        ? new Date(field.value).toISOString().split("T")[0]
                        : ""
                    }
                    label="Start Date"
                    type="date"
                    fullWidth
                    variant="outlined"
                    slotProps={{ inputLabel: { shrink: true } }}
                    error={!!errors.startDate}
                    helperText={errors.startDate?.message as any}
                  />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                {...register("weeklyHours", {
                  valueAsNumber: true,
                })}
                label="Estimated Hours Per Week"
                type="number"
                fullWidth
                variant="outlined"
                slotProps={{ inputLabel: { shrink: true } }}
                error={!!errors.weeklyHours}
                helperText={errors.weeklyHours?.message as any}
              />
            </Grid>
          </Grid>
        </Box>
      )}
    </Box>
  );
};
