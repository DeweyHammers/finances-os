"use client";

/**
 * ResourceEditModal — generic "Edit <Resource>" modal wired to Refine's useModalForm.
 *
 * Companion to ResourceCreateModal for the edit action. Hydrates the form with
 * the loaded record (formatting any Date-like fields into YYYY-MM-DD for native
 * <input type="date">), shows a spinner while loading, and surfaces load
 * errors. Caller wires `useModalForm({ action: "edit" })` and passes it in.
 */

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
import { CancelButton } from "./CancelButton";

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
  // ── Refine modal-form bindings ──
  //  - modal.{close,visible}: open state + programmatic close
  //  - reset: react-hook-form form reset (used to hydrate with fetched record)
  //  - refineCore.query: the useOne() query for the record being edited
  const {
    modal: { close, visible },
    saveButtonProps,
    reset,
    register,
    refineCore: { query: queryResult },
  } = modalProps;

  const editData = queryResult?.data?.data;
  const editLoading = queryResult?.isLoading;

  // ── Hydrate + normalize dates for <input type="date"> ──
  // Native date inputs require "YYYY-MM-DD"; ISO timestamps or Date objects
  // won't render. This effect converts any string field whose name hints at a
  // date into that format before reset() so react-hook-form binds cleanly.
  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (editData && visible) {
      const formattedData = { ...editData };

      // Process all fields to find and format dates for native <input type="date">
      Object.keys(formattedData).forEach((key) => {
        const value = formattedData[key];
        const lowerKey = key.toLowerCase();

        // Exclude specific numeric fields that contain date-like words but are just numbers
        // (e.g. `dueDate` on Bills is a day-of-month integer 1-31, `month` on
        // BudgetMonth is a Unix ms timestamp we handle separately, etc.)
        const isExcluded =
          lowerKey === "duedate" ||
          lowerKey === "month" ||
          lowerKey === "day" ||
          lowerKey === "hours" ||
          lowerKey === "weeklyhours";

        if (value && !isExcluded) {
          const isDateField =
            lowerKey.includes("date") ||
            lowerKey.includes("start") ||
            lowerKey.includes("end");

          if (isDateField) {
            try {
              const d = new Date(value);
              if (!isNaN(d.getTime()) && typeof value === "string") {
                // Only format if it looks like a valid ISO string or date string
                // and NOT if it's a small number that could be a timestamp or ID.
                // Year > 1970 guard filters out small-integer millis (< 1 year
                // of epoch) that would parse as a valid Date but represent IDs.
                const year = d.getUTCFullYear();
                if (year > 1970) {
                  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
                  const day = String(d.getUTCDate()).padStart(2, "0");
                  formattedData[key] = `${year}-${month}-${day}`;
                }
              }
            } catch (e) {
              // Ignore parsing errors
            }
          }
        }
      });

      // Use a small timeout to ensure the form is mounted before resetting.
      // Without this deferral, reset() can race the initial render and leave
      // some fields empty on first open.
      timer = setTimeout(() => {
        reset(formattedData);
      }, 0);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [editData, visible, reset]);

  // If the query failed, we should show an error or at least know why
  // (rendered as a red banner in place of the form body below).
  const queryError = queryResult?.error;

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
        <CancelButton onClick={close} />
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
