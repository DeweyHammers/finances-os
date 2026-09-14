"use client";

/**
 * W2Section — single-field editor for the legacy `w2Amount` AppSettings value.
 *
 * Renders a numeric input for the user's take-home per pay period. The label
 * and helper text change based on the active paymentCycle (Weekly/Bi-Weekly/
 * Monthly) so the field reads naturally regardless of cadence. Wired via
 * react-hook-form's `register` from a parent form (AppSettingsModal).
 */

import { Box, Typography, TextField, Divider } from "@mui/material";
import { UseFormRegister } from "react-hook-form";
import { usePaymentCycle } from "../../../lib/usePaymentCycle";

interface W2SectionProps {
  register: UseFormRegister<any>;
}

export const W2Section = ({ register }: W2SectionProps) => {
  // ── Cadence-aware copy ──
  // Label + helper text swap based on the app's current paymentCycle setting so
  // the field reads naturally ("Weekly Amount" / "each weekly pay period" etc.).
  // Note: MONTHLY is handled here for forward compat even though the settings
  // UI currently only exposes WEEKLY and BI_WEEKLY.
  const { paymentCycle } = usePaymentCycle();
  const isBiWeekly = paymentCycle === "BI_WEEKLY";
  const isMonthly = paymentCycle === "MONTHLY";

  const cadenceWord = isBiWeekly
    ? "bi-weekly"
    : isMonthly
      ? "monthly"
      : "weekly";
  const cadenceTitle = isBiWeekly
    ? "Bi-Weekly"
    : isMonthly
      ? "Monthly"
      : "Weekly";

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1, fontWeight: 800 }}>
        Income
      </Typography>
      <Typography variant="body2" sx={{ mb: 3, color: "text.secondary" }}>
        Your {cadenceWord} take-home income for cash flow projections.
      </Typography>
      <Divider sx={{ mb: 4 }} />
      <TextField
        {...register("w2Amount", { valueAsNumber: true })}
        label={`${cadenceTitle} Amount`}
        type="number"
        fullWidth
        helperText={`Amount received each ${cadenceWord} pay period.`}
      />
    </Box>
  );
};
