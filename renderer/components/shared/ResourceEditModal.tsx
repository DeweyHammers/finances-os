"use client";

import { useEffect, FC, ReactNode } from "react";
import { UseModalFormReturnType } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Button,
  CircularProgress,
  Typography,
} from "@mui/material";
import { FieldValues, UseFormRegister } from "react-hook-form";

interface ResourceEditModalProps {
  modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
  title: string;
  children: ReactNode | ((register: UseFormRegister<any>) => ReactNode);
  maxWidth?: "xs" | "sm" | "md" | "lg" | "xl";
}

export const ResourceEditModal: FC<ResourceEditModalProps> = ({
  modalProps,
  title,
  children,
  maxWidth = "sm",
}) => {
  const {
    modal: { close, visible },
    saveButtonProps,
    reset,
    register,
    refineCore: { query: queryResult },
  } = modalProps;

  const editData = queryResult?.data?.data;
  const editLoading = queryResult?.isLoading;

  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (editData && visible) {
      const formattedData = { ...editData };

      // Process all fields to find and format dates for native <input type="date">
      Object.keys(formattedData).forEach((key) => {
        const value = formattedData[key];
        if (value) {
          const isDateField =
            key.toLowerCase().includes("date") ||
            key.toLowerCase().includes("start") ||
            key.toLowerCase().includes("end");

          if (isDateField) {
            try {
              const d = new Date(value);
              if (!isNaN(d.getTime())) {
                const year = d.getUTCFullYear();
                const month = String(d.getUTCMonth() + 1).padStart(2, "0");
                const day = String(d.getUTCDate()).padStart(2, "0");
                formattedData[key] = `${year}-${month}-${day}`;
              }
            } catch (e) {
              // Ignore parsing errors
            }
          }
        }
      });

      // Use a small timeout to ensure the form is mounted before resetting
      timer = setTimeout(() => {
        reset(formattedData);
      }, 0);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [editData, visible, reset]);

  // If the query failed, we should show an error or at least know why
  const queryError = queryResult?.error;

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
        Edit {title}
      </DialogTitle>
      <DialogContent sx={{ px: 4, pb: 2 }}>
        {editLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}>
            <CircularProgress size={40} thickness={4} />
          </Box>
        ) : queryError ? (
          <Box sx={{ p: 4, textAlign: "center", color: "error.main" }}>
            <Typography>
              Error loading {title.toLowerCase()} details. Please try again.
            </Typography>
          </Box>
        ) : (
          <Box
            component="form"
            sx={{ display: "flex", flexDirection: "column", gap: 3, mt: 2 }}
          >
            {typeof children === "function" ? children(register) : children}
          </Box>
        )}
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
          Update {title}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
