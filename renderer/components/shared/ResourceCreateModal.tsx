"use client";

import { FC, ReactNode } from "react";
import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Button,
} from "@mui/material";
import { FieldValues, UseFormRegister } from "react-hook-form";

interface ResourceCreateModalProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
  title: string;
  children: ReactNode | ((register: UseFormRegister<any>) => ReactNode);
  maxWidth?: "xs" | "sm" | "md" | "lg" | "xl";
}

export const ResourceCreateModal: FC<ResourceCreateModalProps> = ({
  modalProps,
  title,
  children,
  maxWidth = "sm",
}) => {
  const {
    modal: { close, visible },
    register,
    saveButtonProps,
  } = modalProps;

  return (
    <Dialog
      open={visible}
      onClose={close}
      fullWidth
      maxWidth={maxWidth}
      slotProps={{
        paper: {
          sx: {
            borderRadius: 3,
            bgcolor: "background.paper",
            backgroundImage: "none",
          },
        },
      }}
    >
      <DialogTitle sx={{ fontWeight: 900, pt: 3, px: 4, fontSize: "1.5rem" }}>
        New {title}
      </DialogTitle>
      <DialogContent sx={{ px: 4, pb: 2 }}>
        <Box
          component="form"
          sx={{ display: "flex", flexDirection: "column", gap: 3, mt: 2 }}
        >
          {typeof children === "function" ? children(register) : children}
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 4, pt: 1 }}>
        <Button
          onClick={close}
          sx={{ fontWeight: 700, color: "text.secondary" }}
        >
          Cancel
        </Button>
        <Button
          {...saveButtonProps}
          variant="contained"
          disableElevation
          sx={{ px: 4, py: 1, borderRadius: 2, fontWeight: 800 }}
        >
          Save {title}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
