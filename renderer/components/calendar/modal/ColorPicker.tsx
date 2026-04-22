import { Box, Typography } from "@mui/material";
import { COLORS } from "../../../lib/constants";

export const PRESET_COLORS = [
  { label: "Indigo", value: COLORS.gross },
  { label: "Emerald", value: COLORS.hand },
  { label: "Amber", value: COLORS.tax },
  { label: "Rose", value: "#f43f5e" },
  { label: "Cyan", value: "#06b6d4" },
  { label: "Violet", value: "#8b5cf6" },
  { label: "Orange", value: "#f59e0b" },
];

interface ColorPickerProps {
  selectedColor: string;
  onChange: (color: string) => void;
}

export const ColorPicker = ({ selectedColor, onChange }: ColorPickerProps) => {
  return (
    <Box sx={{ mt: 1 }}>
      <Typography
        variant="caption"
        sx={{ color: "text.secondary", mb: 1.5, display: "block" }}
      >
        Event Color
      </Typography>
      <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
        {PRESET_COLORS.map((color) => (
          <Box
            key={color.value}
            onClick={() => onChange(color.value)}
            sx={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              bgcolor: color.value,
              cursor: "pointer",
              border: "2px solid",
              borderColor:
                selectedColor === color.value ? "white" : "transparent",
              boxShadow:
                selectedColor === color.value
                  ? `0 0 0 1px ${color.value}`
                  : "none",
              transition: "all 0.2s",
              "&:hover": { transform: "scale(1.2)" },
            }}
            title={color.label}
          />
        ))}
      </Box>
    </Box>
  );
};
