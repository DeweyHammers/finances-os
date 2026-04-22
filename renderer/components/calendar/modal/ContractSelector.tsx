import { TextField, MenuItem, IconButton, InputAdornment } from "@mui/material";
import { Controller, Control } from "react-hook-form";
import { BaseRecord } from "@refinedev/core";
import ClearIcon from "@mui/icons-material/Clear";
import { CalendarFormValues } from "../EventModal";

interface ContractSelectorProps {
  control: Control<CalendarFormValues>;
  contracts: BaseRecord[];
}

export const ContractSelector = ({
  control,
  contracts,
}: ContractSelectorProps) => {
  return (
    <Controller
      name="contractId"
      control={control}
      render={({ field }) => (
        <TextField
          {...field}
          value={field.value ?? ""}
          select
          label="Contract (Optional)"
          fullWidth
          slotProps={{
            input: {
              endAdornment: field.value && (
                <InputAdornment position="end" sx={{ marginRight: 2 }}>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      field.onChange("");
                    }}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        >
          <MenuItem value="">None</MenuItem>
          {contracts.map((contract) => (
            <MenuItem key={contract.id} value={contract.id}>
              {contract.name}
            </MenuItem>
          ))}
        </TextField>
      )}
    />
  );
};
