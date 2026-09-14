"use client";

/**
 * AddSubsectionModal — dialog for creating a BudgetCategorySubsection under a group.
 *
 * Subsections are a single level of nesting inside a group (Group → Subsection → Item).
 * Items can live either directly under a group OR inside one of its subsections.
 * Triggered from the group header's "Subsection" button in BudgetTable.
 */

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  CircularProgress,
  Typography,
} from "@mui/material";
import { useCreate } from "@refinedev/core";
import { CancelButton } from "../shared/CancelButton";

interface AddSubsectionModalProps {
  open: boolean;
  groupId: string | null;
  groupName?: string;
  nextSortOrder: number;
  onClose: () => void;
}

export const AddSubsectionModal = ({
  open,
  groupId,
  groupName,
  nextSortOrder,
  onClose,
}: AddSubsectionModalProps) => {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { mutate: createSubsection } = useCreate();

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
    if (!name.trim() || !groupId || submitting) return;
    setSubmitting(true);
    createSubsection(
      {
        resource: "BudgetCategorySubsection",
        values: { name: name.trim(), groupId, sortOrder: nextSortOrder },
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
      <DialogTitle sx={{ fontWeight: 900 }}>New Subsection</DialogTitle>
      <DialogContent>
        {groupName && (
          <Typography
            sx={{
              fontSize: "0.8rem",
              color: "text.secondary",
              fontWeight: 700,
              mb: 1,
            }}
          >
            Inside <strong>{groupName}</strong>
          </Typography>
        )}
        <TextField
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          label="Subsection Name"
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
          Add
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
