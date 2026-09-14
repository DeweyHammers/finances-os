"use client";

/**
 * CancelButton — themed rose-red Cancel button used across every modal.
 *
 * Thin wrapper around MUI Button that locks in the app's cancel styling
 * (rose-500 text, transparent bg, subtle rose tint on hover). `color` is
 * omitted from the props type because it's fixed. `sx` overrides are merged
 * on top so callers can still tweak spacing per-usage.
 */

import { Button, ButtonProps } from "@mui/material";
import { ReactNode } from "react";

interface CancelButtonProps extends Omit<ButtonProps, "color"> {
  children?: ReactNode;
}

export const CancelButton = ({ children = "Cancel", sx, ...rest }: CancelButtonProps) => (
  <Button
    {...rest}
    sx={{
      fontWeight: 700,
      textTransform: "none",
      color: "#f43f5e",
      "&:hover": {
        bgcolor: "rgba(244, 63, 94, 0.08)",
        color: "#fb7185",
      },
      ...sx,
    }}
  >
    {children}
  </Button>
);
