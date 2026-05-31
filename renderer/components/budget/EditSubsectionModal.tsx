"use client";

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
import { useUpdate } from "@refinedev/core";
import type { BudgetSubsection } from "./BudgetTable";
import { CancelButton } from "../shared/CancelButton";

interface EditSubsectionModalProps {
  open: boolean;
  subsection: BudgetSubsection | null;
  onClose: () => void;
}

export const EditSubsectionModal = ({
  open,
  subsection,
  onClose,
}: EditSubsectionModalProps) => {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { mutate: update } = useUpdate();

  useEffect(() => {
    if (open && subsection) {
      setName(subsection.name);
      setSubmitting(false);
    }
  }, [open, subsection]);

  if (!subsection) return null;

  const handleSave = () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    update(
      {
        resource: "BudgetCategorySubsection",
        id: subsection.id,
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
      <DialogTitle sx={{ fontWeight: 900 }}>Edit Subsection</DialogTitle>
      <DialogContent>
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
        <CancelButton onClick={onClose} disabled={submitting} />
        <Button
          variant="contained"
          disableElevation
          onClick={handleSave}
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
