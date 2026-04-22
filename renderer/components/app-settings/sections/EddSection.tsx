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

interface EddSectionProps {
  register: UseFormRegister<any>;
  eddActive: boolean;
  onToggleChange: (name: string, checked: boolean) => void;
}

export const EddSection = ({
  register,
  eddActive,
  onToggleChange,
}: EddSectionProps) => {
  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1, fontWeight: 800 }}>
        EDD
      </Typography>
      <Typography variant="body2" sx={{ mb: 3, color: "text.secondary" }}>
        Configure your EDD income source and weekly claim details.
      </Typography>
      <Divider sx={{ mb: 4 }} />
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <FormControlLabel
          labelPlacement="start"
          control={
            <AppSwitch
              checked={!!eddActive}
              onChange={(e) => onToggleChange("eddActive", e.target.checked)}
            />
          }
          label={
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1">Active Status</Typography>
              <Typography variant="body2" color="text.secondary">
                Toggle if EDD is currently an active income source.
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
        <Box sx={{ display: "flex", gap: 3 }}>
          <TextField
            {...register("baseEddWeeklyAmount", { valueAsNumber: true })}
            label="Base Weekly Amount"
            type="number"
            fullWidth
            disabled={!eddActive}
            variant="outlined"
            sx={{ flex: 1 }}
          />
          <TextField
            {...register("eddRemainingBalance", { valueAsNumber: true })}
            label="Starting Amount"
            type="number"
            fullWidth
            disabled={!eddActive}
            variant="outlined"
            sx={{ flex: 1 }}
          />
        </Box>
      </Box>
    </Box>
  );
};
