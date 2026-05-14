"use client";

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
    if (!name.trim()) return;
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
                ? "This item is sourced from a Bill. The amount and cycle are managed on the Bills page."
                : "This item is sourced from Personal entries. Amount and cycle are managed on the Personal page."}
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
                ? "The display name was auto-generated from the Bill but can be customized here."
                : ""
            }
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 4, pt: 1 }}>
        <Button
          onClick={onClose}
          sx={{ fontWeight: 700 }}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          disableElevation
          onClick={handleSave}
          disabled={!name.trim() || submitting}
          startIcon={submitting ? <CircularProgress size={16} /> : null}
          sx={{ fontWeight: 800, borderRadius: 2, px: 4 }}
        >
          {submitting ? "Saving..." : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
