"use client";

import { Box, Typography } from "@mui/material";
import { formatMoney } from "../../lib/cents";

interface AvailableCellProps {
  cents: number;
  onClick?: (anchor: HTMLElement) => void;
}

export const AvailableCell = ({ cents, onClick }: AvailableCellProps) => {
  const state =
    cents < 0 ? "negative" : cents === 0 ? "zero" : "positive";
  const colors = {
    negative: { bg: "rgba(244, 63, 94, 0.15)", text: "#f43f5e" },
    zero: { bg: "rgba(255, 255, 255, 0.04)", text: "text.secondary" },
    positive: { bg: "rgba(61, 188, 131, 0.15)", text: "#3DBC83" },
  } as const;
  const c = colors[state];

  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={(e) => onClick?.(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick?.(e.currentTarget as HTMLElement);
      }}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: c.bg,
        color: c.text,
        borderRadius: "999px",
        px: 1.25,
        py: 0.4,
        cursor: "pointer",
        fontVariantNumeric: "tabular-nums",
        transition: "background 120ms",
        "&:hover": {
          bgcolor:
            state === "negative"
              ? "rgba(244, 63, 94, 0.25)"
              : state === "positive"
              ? "rgba(61, 188, 131, 0.25)"
              : "rgba(255, 255, 255, 0.08)",
        },
      }}
    >
      <Typography
        sx={{
          fontWeight: 800,
          color: c.text,
          fontSize: "0.95rem",
        }}
      >
        {formatMoney(cents)}
      </Typography>
    </Box>
  );
};
