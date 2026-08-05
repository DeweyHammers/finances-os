"use client";

import {
  TextField,
  Grid,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
} from "@mui/material";
import { UseFormReturn } from "react-hook-form";

interface PersonalFormFieldsProps {
  formProps: UseFormReturn<any>;
}

// Sentinel value used when the user picks "Day of Month" mode in the toggle
const DAY_MODE_SENTINEL = "day";

export const PersonalFormFields = ({ formProps }: PersonalFormFieldsProps) => {
  const {
    register,
    formState: { errors },
    setValue,
    watch,
  } = formProps;

  const repeatWeekly = !!watch("repeatWeekly");
  const splitAcrossWeeks = !!watch("splitAcrossWeeks");
  const dueDate = watch("dueDate");
  const weekOfMonth = watch("weekOfMonth");

  // Cadence: mutually-exclusive across FIXED (dueDate/weekOfMonth), REPEAT, SPLIT.
  type Cadence = "FIXED" | "REPEAT" | "SPLIT";
  const cadence: Cadence = splitAcrossWeeks ? "SPLIT" : repeatWeekly ? "REPEAT" : "FIXED";

  const handleCadenceChange = (_: any, val: Cadence | null) => {
    if (val == null || val === cadence) return;
    // Backfill dueDate to 1 whenever it's empty/invalid — the schema requires
    // an Int and the API's transformBody leaves empty strings as strings,
    // which Prisma then rejects with a 500.
    const ensureDueDate = () => {
      if (!dueDate || isNaN(Number(dueDate))) setValue("dueDate", 1);
    };
    if (val === "REPEAT") {
      setValue("repeatWeekly", true);
      setValue("splitAcrossWeeks", false);
      setValue("weekOfMonth", null);
      ensureDueDate();
    } else if (val === "SPLIT") {
      setValue("splitAcrossWeeks", true);
      setValue("repeatWeekly", false);
      setValue("weekOfMonth", null);
      ensureDueDate();
    } else {
      setValue("repeatWeekly", false);
      setValue("splitAcrossWeeks", false);
      ensureDueDate();
    }
  };

  // Toggle value: 1|2|3|4 for a specific week, "day" for day-of-month mode
  const scheduleValue: number | "day" = weekOfMonth != null ? weekOfMonth : DAY_MODE_SENTINEL;

  const handleScheduleChange = (_: any, val: number | "day" | null) => {
    if (val == null) return;
    if (val === DAY_MODE_SENTINEL) {
      setValue("weekOfMonth", null);
      setValue("dueDate", (!dueDate || isNaN(Number(dueDate))) ? 1 : dueDate);
    } else {
      setValue("weekOfMonth", val);
      if (!dueDate || isNaN(Number(dueDate))) setValue("dueDate", 1);
    }
  };

  const toggleBtnSx = {
    flex: 1,
    color: "text.secondary",
    borderColor: "rgba(129,140,248,0.2)",
    fontSize: "0.8rem",
    fontWeight: 700,
    py: 0.75,
    textTransform: "none",
    "&.Mui-selected": {
      color: "#818cf8",
      bgcolor: "rgba(129,140,248,0.15)",
      borderColor: "rgba(129,140,248,0.5)",
    },
  };

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
          {...register("amount", { required: "Required", valueAsNumber: true })}
          label={cadence === "SPLIT" ? "Monthly Total" : "Amount"}
          type="number"
          fullWidth
          variant="outlined"
          slotProps={{ inputLabel: { shrink: true } }}
          error={!!errors.amount}
          helperText={
            (errors.amount?.message as any) ??
            (cadence === "SPLIT"
              ? "Split across pay weeks so the wife target still clears"
              : undefined)
          }
        />
      </Grid>

      {/* Cadence picker: Fixed / Every Week / Split across weeks */}
      <Grid size={{ xs: 12 }}>
        <Typography
          variant="caption"
          sx={{ color: "text.secondary", fontWeight: 700, display: "block", mb: 0.75 }}
        >
          Cadence
        </Typography>
        <ToggleButtonGroup
          value={cadence}
          exclusive
          onChange={handleCadenceChange}
          size="small"
          fullWidth
          sx={{ "& .MuiToggleButton-root": toggleBtnSx }}
        >
          <ToggleButton value="FIXED">Fixed Week / Day</ToggleButton>
          <ToggleButton value="REPEAT">Every Pay Week</ToggleButton>
          <ToggleButton value="SPLIT">Split Monthly</ToggleButton>
        </ToggleButtonGroup>
      </Grid>

      {/* Schedule picker — only when Fixed cadence */}
      {cadence === "FIXED" && (
        <Grid size={{ xs: 12 }}>
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", fontWeight: 700, display: "block", mb: 0.75 }}
          >
            Schedule
          </Typography>
          <ToggleButtonGroup
            value={scheduleValue}
            exclusive
            onChange={handleScheduleChange}
            size="small"
            fullWidth
            sx={{ "& .MuiToggleButton-root": toggleBtnSx }}
          >
            <ToggleButton value={1}>Week 1</ToggleButton>
            <ToggleButton value={2}>Week 2</ToggleButton>
            <ToggleButton value={3}>Week 3</ToggleButton>
            <ToggleButton value={4}>Week 4</ToggleButton>
            <ToggleButton value={DAY_MODE_SENTINEL}>Day</ToggleButton>
          </ToggleButtonGroup>

          {scheduleValue === DAY_MODE_SENTINEL && (
            <TextField
              {...register("dueDate", {
                required: "Required",
                valueAsNumber: true,
                min: 1,
                max: 31,
              })}
              label="Day of Month (1–31)"
              type="number"
              fullWidth
              variant="outlined"
              slotProps={{ inputLabel: { shrink: true } }}
              error={!!errors.dueDate}
              helperText={errors.dueDate?.message as any}
              sx={{ mt: 1.5 }}
            />
          )}
        </Grid>
      )}
    </Grid>
  );
};
