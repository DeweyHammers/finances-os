"use client";

import { useRef } from "react";
import { Box, Button, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import { formatMoney } from "../../lib/cents";

interface ReadyToAssignPillProps {
  cents: number;
  onAssignClick?: (anchor: HTMLElement) => void;
}

export const ReadyToAssignPill = ({
  cents,
  onAssignClick,
}: ReadyToAssignPillProps) => {
  const pillRef = useRef<HTMLDivElement>(null);
  const state =
    cents === 0 ? "balanced" : cents > 0 ? "to-assign" : "over-assigned";
  const colors = {
    balanced: {
      bg: "rgba(255, 255, 255, 0.05)",
      border: "rgba(255, 255, 255, 0.08)",
      text: "#cbd5e1",
      sub: "rgba(255,255,255,0.45)",
      btnBg: "rgba(255, 255, 255, 0.08)",
      btnHover: "rgba(255, 255, 255, 0.12)",
      btnText: "#cbd5e1",
    },
    "to-assign": {
      bg: "rgba(61, 188, 131, 0.18)",
      border: "rgba(61, 188, 131, 0.45)",
      text: "white",
      sub: "rgba(255,255,255,0.7)",
      btnBg: "rgba(61, 188, 131, 0.45)",
      btnHover: "rgba(61, 188, 131, 0.6)",
      btnText: "white",
    },
    "over-assigned": {
      bg: "rgba(244, 63, 94, 0.15)",
      border: "rgba(244, 63, 94, 0.45)",
      text: "white",
      sub: "rgba(255,255,255,0.7)",
      btnBg: "rgba(244, 63, 94, 0.45)",
      btnHover: "rgba(244, 63, 94, 0.6)",
      btnText: "white",
    },
  } as const;
  const c = colors[state];
  const label =
    state === "balanced"
      ? "All Money Assigned"
      : state === "to-assign"
      ? "Ready to Assign"
      : "Over-Assigned";

  return (
    <Box
      ref={pillRef}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        bgcolor: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 2.5,
        pl: 2.5,
        pr: 1.25,
        py: 1,
        minWidth: 280,
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <Typography
          sx={{
            fontWeight: 900,
            color: c.text,
            fontSize: "1.5rem",
            lineHeight: 1.1,
            letterSpacing: "-0.5px",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatMoney(cents)}
        </Typography>
        <Typography
          sx={{
            fontWeight: 600,
            color: c.sub,
            fontSize: "0.8rem",
            letterSpacing: 0.3,
          }}
        >
          {label}
        </Typography>
      </Box>
      {state === "balanced" ? (
        <CheckCircleIcon
          sx={{ color: "rgba(255, 255, 255, 0.35)", fontSize: 28, mr: 0.5 }}
        />
      ) : (
        <Button
          onClick={() => {
            if (pillRef.current) onAssignClick?.(pillRef.current);
          }}
          endIcon={<ArrowDropDownIcon />}
          disableElevation
          sx={{
            fontWeight: 800,
            textTransform: "none",
            color: c.btnText,
            bgcolor: c.btnBg,
            borderRadius: 1.5,
            px: 2,
            py: 0.6,
            fontSize: "0.9rem",
            "&:hover": { bgcolor: c.btnHover },
          }}
        >
          Assign
        </Button>
      )}
    </Box>
  );
};
