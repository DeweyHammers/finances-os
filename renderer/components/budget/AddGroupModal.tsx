"use client";

/**
 * AddGroupModal — dialog for creating a top-level BudgetCategoryGroup.
 *
 * Top-level groups sit above items and subsections on the Plan page. Opened
 * from the "Add Group" button in BudgetPage's toolbar or the empty-state CTA.
 * `nextSortOrder` is passed in so the new group appends to the bottom of
 * the current ordering (Refine sorts groups by sortOrder ascending).
 */

import { useEffect, useState } from "react";
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
import { CancelButton } from "../shared/CancelButton";

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

  // Reset on open only — never on close — so the typed name doesn't flash
  // back to empty during the close animation.
  useEffect(() => {
    if (open) {
      setName("");
      setSubmitting(false);
    }
  }, [open]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = () => {
    if (!name.trim() || submitting) return;
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
        <CancelButton onClick={handleClose} disabled={submitting} />
        <Button
          variant="contained"
          disableElevation
          onClick={handleSubmit}
          disabled={!name.trim() || submitting}
          sx={{
            fontWeight: 800,
            borderRadius: 2,
            position: "relative",
            ...(submitting && {
              "&.Mui-disabled": {
                bgcolor: "primary.main",
              },
            }),
          }}
        >
          Add Group
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
