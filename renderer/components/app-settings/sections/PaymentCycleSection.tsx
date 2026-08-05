"use client";

import {
  Box,
  Typography,
  Divider,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import { useUpdate } from "@refinedev/core";
import {
  normalizePaymentCycle,
  PaymentCycle,
} from "../../../lib/cycle-utils";

const PAY_DAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
];

interface PaymentCycleSectionProps {
  currentValue: string | undefined;
  currentPayDay?: number;
}

const OPTIONS: { value: PaymentCycle; label: string; description: string }[] = [
  {
    value: "WEEKLY",
    label: "Weekly",
    description:
      "Pay arrives every week. The Plan and Overview show 4 pay periods per month.",
  },
  {
    value: "BI_WEEKLY",
    label: "Bi-Weekly",
    description:
      "Pay arrives every two weeks. The Plan and Overview show 2 pay periods per month.",
  },
];

export const PaymentCycleSection = ({
  currentValue,
  currentPayDay,
}: PaymentCycleSectionProps) => {
  const current = normalizePaymentCycle(currentValue);
  const payDay = currentPayDay ?? 2;

  const { mutate: updateSettings } = useUpdate();

  const handleChange = (_: unknown, next: PaymentCycle | null) => {
    if (!next || next === current) return;
    updateSettings({
      resource: "AppSettings",
      id: "global",
      values: { paymentCycle: next },
      successNotification: false,
    });
  };

  const handlePayDayChange = (_: unknown, next: number | null) => {
    if (next == null) return;
    updateSettings({
      resource: "AppSettings",
      id: "global",
      values: { payDay: next },
      successNotification: false,
    });
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1, fontWeight: 800 }}>
        Payment Cycle
      </Typography>
      <Typography variant="body2" sx={{ mb: 3, color: "text.secondary" }}>
        Tell the app how often you get paid. This controls how many pay periods
        appear in the Plan and Overview each month.
      </Typography>
      <Divider sx={{ mb: 3 }} />

      <ToggleButtonGroup
        value={current}
        exclusive
        onChange={handleChange}
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 2,
          width: "100%",
          "& .MuiToggleButton-root": {
            border: "1px solid rgba(129, 140, 248, 0.2)",
            borderRadius: 2,
            textAlign: "left",
            justifyContent: "flex-start",
            alignItems: "flex-start",
            flexDirection: "column",
            p: 2,
            textTransform: "none",
            color: "text.secondary",
            "&.Mui-selected": {
              bgcolor: "rgba(129, 140, 248, 0.15)",
              borderColor: "primary.light",
              color: "white",
              "&:hover": { bgcolor: "rgba(129, 140, 248, 0.2)" },
            },
          },
        }}
      >
        {OPTIONS.map((opt) => (
          <ToggleButton key={opt.value} value={opt.value} aria-label={opt.label}>
            <Typography sx={{ fontWeight: 800, fontSize: "1rem", mb: 0.5 }}>
              {opt.label}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {opt.description}
            </Typography>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Box sx={{ mt: 4 }}>
        <Typography variant="h6" sx={{ mb: 0.5, fontWeight: 800 }}>
          Pay Day
        </Typography>
        <Typography variant="body2" sx={{ mb: 2, color: "text.secondary" }}>
          Which day of the week do you get paid? Bills on the Overview will be
          grouped into pay-week windows starting on this day.
        </Typography>
        <ToggleButtonGroup
          value={payDay}
          exclusive
          onChange={handlePayDayChange}
          sx={{
            display: "flex",
            gap: 1,
            "& .MuiToggleButton-root": {
              border: "1px solid rgba(129, 140, 248, 0.2)",
              borderRadius: 2,
              px: 2.5,
              py: 1,
              textTransform: "none",
              fontWeight: 700,
              color: "text.secondary",
              "&.Mui-selected": {
                bgcolor: "rgba(129, 140, 248, 0.15)",
                borderColor: "primary.light",
                color: "white",
                "&:hover": { bgcolor: "rgba(129, 140, 248, 0.2)" },
              },
            },
          }}
        >
          {PAY_DAY_OPTIONS.map((opt) => (
            <ToggleButton
              key={opt.value}
              value={opt.value}
              aria-label={opt.label}
            >
              {opt.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>
    </Box>
  );
};
