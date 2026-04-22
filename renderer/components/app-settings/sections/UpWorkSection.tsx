"use client";

import {
  Box,
  Typography,
  TextField,
  FormControlLabel,
  Divider,
} from "@mui/material";
import { UseFormRegister } from "react-hook-form";
import { AppSwitch } from "../AppSwitch";

interface UpWorkSectionProps {
  register: UseFormRegister<any>;
  upworkActive: boolean;
  upworkExpensesHoldActive: boolean;
  onToggleChange: (name: string, checked: boolean) => void;
}

export const UpWorkSection = ({
  register,
  upworkActive,
  upworkExpensesHoldActive,
  onToggleChange,
}: UpWorkSectionProps) => {
  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1, fontWeight: 800 }}>
        UpWork
      </Typography>
      <Typography variant="body2" sx={{ mb: 3, color: "text.secondary" }}>
        Configure your UpWork income settings, tax provisions, and withdrawal thresholds.
      </Typography>
      <Divider sx={{ mb: 4 }} />

      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <FormControlLabel
          labelPlacement="start"
          control={
            <AppSwitch
              checked={!!upworkActive}
              onChange={(e) => onToggleChange("upworkActive", e.target.checked)}
            />
          }
          label={
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1">Active Status</Typography>
              <Typography variant="body2" color="text.secondary">
                Toggle if UpWork is currently an active income source.
              </Typography>
            </Box>
          }
          sx={{
            display: "flex",
            justifyContent: "space-between",
            width: "100%",
            ml: 0,
            mb: 1,
          }}
        />

        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            opacity: upworkActive ? 1 : 0.5,
            pointerEvents: upworkActive ? "auto" : "none",
          }}
        >
          <Box sx={{ display: "flex", gap: 3 }}>
            <TextField
              {...register("upworkTaxProvisionPercent", {
                valueAsNumber: true,
              })}
              label="Tax Provision %"
              type="number"
              fullWidth
              disabled={!upworkActive}
              slotProps={{ htmlInput: { step: 0.01 } }}
              sx={{ flex: 1 }}
            />
            <TextField
              {...register("upworkMinWithdrawalAmount", {
                valueAsNumber: true,
              })}
              label="Min Withdrawal Balance"
              type="number"
              fullWidth
              disabled={!upworkActive}
              sx={{ flex: 1 }}
            />
          </Box>

          <Divider sx={{ opacity: 0.1 }} />

          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Obligations
            </Typography>
            <TextField
              {...register("wifeMonthlyAmount", {
                valueAsNumber: true,
              })}
              label="Wife Monthly Amount"
              type="number"
              fullWidth
              disabled={!upworkActive}
              helperText="Monthly obligation to be included in income gap calculations"
            />
          </Box>

          <Divider sx={{ opacity: 0.1 }} />

          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <FormControlLabel
              labelPlacement="start"
              control={
                <AppSwitch
                  checked={!!upworkExpensesHoldActive}
                  disabled={!upworkActive}
                  onChange={(e) =>
                    onToggleChange("upworkExpensesHoldActive", e.target.checked)
                  }
                />
              }
              label={
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle1">Hold for Expenses</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Reserve a fixed amount from your UpWork balance for business expenses.
                  </Typography>
                </Box>
              }
              sx={{
                display: "flex",
                justifyContent: "space-between",
                width: "100%",
                ml: 0,
                mb: 1,
              }}
            />

            {upworkExpensesHoldActive && (
              <TextField
                {...register("upworkExpensesHoldAmount", {
                  valueAsNumber: true,
                })}
                label="Expense Hold Amount"
                type="number"
                fullWidth
                disabled={!upworkActive}
              />
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
