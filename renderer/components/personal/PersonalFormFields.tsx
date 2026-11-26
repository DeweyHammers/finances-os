"use client";

/**
 * PersonalFormFields — shared input set for Personal create + edit modals.
 *
 * Personal cadence is tri-state: FIXED (specific week or day-of-month),
 * REPEAT (every pay week — flat allowance), SPLIT (monthly total spread across
 * pay weeks). The three schema flags — `repeatWeekly`, `splitAcrossWeeks`,
 * `weekOfMonth`, `dueDate` — are collapsed into a single ToggleButtonGroup here
 * and mapped back on change. Every branch backfills `dueDate` to a valid int
 * because Prisma rejects empty strings for required Int columns (see
 * ensureDueDate).
 */

import {
  Box,
  TextField,
  Grid,
  ToggleButtonGroup,
  ToggleButton,
} from "@mui/material";
import { UseFormReturn } from "react-hook-form";
import { FieldLabel, FormSection, FormSectionNote } from "../shared/FormSection";
import { getOrdinal } from "../../lib/date-utils";

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

  // Live-watch the four cadence-related fields so the toggles react as the user clicks.
  const repeatWeekly = !!watch("repeatWeekly");
  const splitAcrossWeeks = !!watch("splitAcrossWeeks");
  const dueDate = watch("dueDate");
  const weekOfMonth = watch("weekOfMonth");

  // Cadence: mutually-exclusive across FIXED (dueDate/weekOfMonth), REPEAT, SPLIT.
  type Cadence = "FIXED" | "REPEAT" | "SPLIT";
  const cadence: Cadence = splitAcrossWeeks ? "SPLIT" : repeatWeekly ? "REPEAT" : "FIXED";

  // Called when the top ToggleButtonGroup changes. Sets the two boolean flags plus
  // clears/backfills weekOfMonth/dueDate to keep the record in a consistent state
  // (no cadence permits `weekOfMonth != null` alongside repeatWeekly/split).
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

  // Only rendered when cadence === FIXED. Picks one of four pay-week buckets or the
  // Day sub-mode. When Day is selected, weekOfMonth clears and a numeric input for
  // dueDate appears below.
  const handleScheduleChange = (_: any, val: number | "day" | null) => {
    if (val == null) return;
    if (val === DAY_MODE_SENTINEL) {
      setValue("weekOfMonth", null);
      setValue("dueDate", (!dueDate || isNaN(Number(dueDate))) ? 1 : dueDate);
    } else {
      setValue("weekOfMonth", val);
      // Even in Week-N mode dueDate must be a valid Int for Prisma. Backfill to 1
      // so the row is savable even before the user opens the Day sub-input.
      if (!dueDate || isNaN(Number(dueDate))) setValue("dueDate", 1);
    }
  };

  // What the picked cadence means, in words — shown in the card's strip.
  const dayNumber = Number(dueDate);
  const scheduleSentence =
    cadence === "REPEAT"
      ? "This amount comes out of every pay week."
      : cadence === "SPLIT"
        ? "The monthly total is spread across the month's pay weeks."
        : weekOfMonth != null
          ? `Once a month, in pay week ${weekOfMonth}.`
          : Number.isInteger(dayNumber) && dayNumber >= 1 && dayNumber <= 31
            ? `Once a month, on the ${dayNumber}${getOrdinal(dayNumber)}.`
            : "Once a month, on the day you enter.";

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
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { inputMode: "decimal" } }}
          error={!!errors.amount}
          helperText={
            (errors.amount?.message as any) ??
            (cadence === "SPLIT"
              ? "Split across pay weeks so the surplus target still clears"
              : undefined)
          }
        />
      </Grid>

      {/* When it comes out: ONE card (shared/FormSection) for the cadence
          picker, the week / day picker that belongs to "Fixed", and a strip
          that says in words what the choice means. They were two loose
          captions with toggles under the amount until Nov 25 2026. */}
      <Grid size={{ xs: 12 }}>
        <FormSection
          title="WHEN IT COMES OUT"
          description="Once a month, every pay week, or one monthly total spread over the pay weeks."
          footer={<FormSectionNote>{scheduleSentence}</FormSectionNote>}
        >
          <FieldLabel>CADENCE</FieldLabel>
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

          {/* Schedule picker — only when Fixed cadence */}
          {cadence === "FIXED" && (
            <Box sx={{ mt: 2 }}>
              <FieldLabel>SCHEDULE</FieldLabel>
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
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { inputMode: "numeric" } }}
                  error={!!errors.dueDate}
                  helperText={errors.dueDate?.message as any}
                  sx={{ mt: 2 }}
                />
              )}
            </Box>
          )}
        </FormSection>
      </Grid>
    </Grid>
  );
};
