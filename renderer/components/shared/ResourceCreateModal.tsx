"use client";

/**
 * ResourceCreateModal — generic "New <Resource>" modal wired to Refine's useModalForm.
 *
 * Renders a titled Dialog with a form body (supplied by the caller either as
 * static JSX or as a render function receiving `register`) and a Cancel/Save
 * button pair. Used by ResourceList and other CRUD hosts — the caller wires
 * `useModalForm({ action: "create" })` and passes the return value in as
 * `modalProps`. Zero-exit-duration keeps the modal snappy on close.
 */

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
import { CancelButton } from "./CancelButton";

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
  // Destructure the pieces of Refine's useModalForm we actually need:
  //  - modal.{close,visible}: open state + programmatic close
  //  - register: react-hook-form field binder passed to children
  //  - saveButtonProps: pre-wired onClick/disabled for the submit button
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
      transitionDuration={{ enter: 225, exit: 0 }}
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
        {/* Children can be static JSX (already wired to their own register)
            or a render function that receives our `register` — the latter
            keeps callers from having to thread useModalForm's return value
            through their JSX manually. */}
        <Box
          component="form"
          sx={{ display: "flex", flexDirection: "column", gap: 3, mt: 2 }}
        >
          {typeof children === "function" ? children(register) : children}
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 4, pt: 1 }}>
        <CancelButton onClick={close} />
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
