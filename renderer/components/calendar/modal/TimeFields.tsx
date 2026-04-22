import { Box } from "@mui/material";
import { Controller, Control } from "react-hook-form";
import { DateTimePicker, DatePicker } from "@mui/x-date-pickers";
import { CalendarFormValues } from "../EventModal";

interface TimeFieldsProps {
  control: Control<CalendarFormValues>;
  isAllDay: boolean;
  errors: any;
}

export const TimeFields = ({ control, isAllDay, errors }: TimeFieldsProps) => {
  const commonSlotProps = (name: string) => ({
    textField: {
      fullWidth: true,
      error: !!errors[name],
      helperText: errors[name]?.message,
    },
    desktopPaper: {
      sx: {
        "& .MuiMenuItem-root.Mui-disabled": { display: "none !important" },
      },
    },
  });

  if (isAllDay) {
    return (
      <Box sx={{ display: "flex", gap: 2 }}>
        <Controller
          name="startTime"
          control={control}
          rules={{ required: true }}
          render={({ field }) => (
            <DatePicker
              label="Start Date"
              value={field.value ? new Date(field.value) : null}
              onChange={(date) => {
                if (date) {
                  const d = new Date(date);
                  d.setHours(0, 0, 0, 0);
                  field.onChange(d);
                }
              }}
              slotProps={{
                textField: { fullWidth: true, error: !!errors.startTime },
              }}
            />
          )}
        />
        <Controller
          name="endTime"
          control={control}
          rules={{ required: true }}
          render={({ field }) => (
            <DatePicker
              label="End Date"
              value={field.value ? new Date(field.value) : null}
              onChange={(date) => {
                if (date) {
                  const d = new Date(date);
                  d.setHours(23, 59, 59, 999);
                  field.onChange(d);
                }
              }}
              slotProps={{
                textField: { fullWidth: true, error: !!errors.endTime },
              }}
            />
          )}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Controller
        name="startTime"
        control={control}
        rules={{ required: true }}
        render={({ field }) => (
          <DateTimePicker
            label="Start Date & Time"
            value={field.value ? new Date(field.value) : null}
            onChange={field.onChange}
            timeSteps={{ minutes: 30 }}
            slotProps={commonSlotProps("startTime")}
          />
        )}
      />
      <Controller
        name="endTime"
        control={control}
        rules={{
          required: true,
          validate: (value, formValues) => {
            const start = new Date(formValues.startTime);
            const end = new Date(value);
            return (
              end >= new Date(start.getTime() + 30 * 60000) ||
              "End time must be at least 30 minutes after start time"
            );
          },
        }}
        render={({ field }) => (
          <DateTimePicker
            label="End Date & Time"
            value={field.value ? new Date(field.value) : null}
            onChange={field.onChange}
            timeSteps={{ minutes: 30 }}
            slotProps={commonSlotProps("endTime")}
          />
        )}
      />
    </Box>
  );
};
