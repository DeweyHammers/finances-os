"use client";

/**
 * EditItemModal — rename a BudgetCategoryItem's display name.
 *
 * Only the display name is editable here — amounts, cycles, and sourceType
 * stay locked because BILL/PERSONAL_NAME items derive those from their
 * upstream Bill/Personal record. The Alert callout warns the user that
 * editing name here breaks the auto-sync with the source record's name.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  TextField,
  Alert,
  CircularProgress,
} from "@mui/material";
import { useUpdate } from "@refinedev/core";
import type { BudgetItem } from "./BudgetTable";
import { CancelButton } from "../shared/CancelButton";

interface EditItemModalProps {
  open: boolean;
  item: BudgetItem | null;
  onClose: () => void;
}

export const EditItemModal = ({ open, item, onClose }: EditItemModalProps) => {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { mutate: update } = useUpdate();

  useEffect(() => {
    if (open && item) {
      setName(item.name);
      setSubmitting(false);
    }
  }, [open, item]);

  if (!item) return null;

  const isCustom = item.sourceType === "CUSTOM";
  const isBill = item.sourceType === "BILL";

  const handleSave = () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    update(
      {
        resource: "BudgetCategoryItem",
        id: item.id,
        values: { name: name.trim() },
        successNotification: false,
      },
      {
        onSettled: () => {
          setSubmitting(false);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="sm"
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
      <DialogTitle sx={{ fontWeight: 900, pt: 3, px: 4 }}>
        Edit Budget Item
      </DialogTitle>
      <DialogContent sx={{ px: 4, pb: 2 }}>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            mt: 1,
          }}
        >
          {!isCustom && (
            <Alert severity="info" variant="outlined">
              {isBill
                ? "This item is sourced from a Bill. The amount and cycle are managed on the Bills page — this display name stays in sync with the latest Bill name."
                : "This item is sourced from Personal entries. Amount and cycle are managed on the Personal page — this display name stays in sync with the latest Personal name."}
            </Alert>
          )}
          <TextField
            label="Display Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            variant="outlined"
            slotProps={{ inputLabel: { shrink: true } }}
            helperText={
              isBill
                ? "Pre-filled from the current Bill name. Edits here override the auto-sync for this category."
                : ""
            }
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 4, pt: 1 }}>
        <CancelButton onClick={onClose} disabled={submitting} />
        <Button
          variant="contained"
          disableElevation
          onClick={handleSave}
          disabled={!name.trim() || submitting}
          sx={{
            fontWeight: 800,
            borderRadius: 2,
            px: 4,
            position: "relative",
            ...(submitting && {
              "&.Mui-disabled": {
                bgcolor: "primary.main",
              },
            }),
          }}
        >
          Save
          {submitting && (
            <CircularProgress
              size={16}
              sx={{ position: "absolute", right: 12, color: "inherit" }}
            />
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
