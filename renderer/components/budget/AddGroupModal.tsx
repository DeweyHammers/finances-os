"use client";

import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  CircularProgress,
} from "@mui/material";
import { useCreate } from "@refinedev/core";

interface AddGroupModalProps {
  open: boolean;
  onClose: () => void;
  nextSortOrder?: number;
}

export const AddGroupModal = ({
  open,
  onClose,
  nextSortOrder = 0,
}: AddGroupModalProps) => {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { mutate: createGroup } = useCreate();

  const handleClose = () => {
    if (submitting) return;
    setName("");
    onClose();
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    setSubmitting(true);
    createGroup(
      {
        resource: "BudgetCategoryGroup",
        values: { name: name.trim(), sortOrder: nextSortOrder },
        successNotification: false,
      },
      {
        onSettled: () => {
          setSubmitting(false);
          setName("");
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="xs"
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
      <DialogTitle sx={{ fontWeight: 900 }}>New Category Group</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          label="Group Name"
          fullWidth
          variant="outlined"
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions sx={{ p: 3, pt: 1 }}>
        <Button
          onClick={handleClose}
          sx={{ fontWeight: 700 }}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          disableElevation
          onClick={handleSubmit}
          disabled={submitting || !name.trim()}
          startIcon={submitting ? <CircularProgress size={16} /> : null}
          sx={{ fontWeight: 800, borderRadius: 2 }}
        >
          {submitting ? "Saving..." : "Add Group"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
