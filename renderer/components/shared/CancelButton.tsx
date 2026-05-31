"use client";

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
