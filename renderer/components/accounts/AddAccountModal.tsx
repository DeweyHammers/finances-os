"use client";

import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  Box,
  CircularProgress,
} from "@mui/material";
import { useCreate } from "@refinedev/core";
import { toCents } from "../../lib/cents";

interface AddAccountModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (accountId: string) => void;
}

export const AddAccountModal = ({
  open,
  onClose,
  onCreated,
}: AddAccountModalProps) => {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [workingBalance, setWorkingBalance] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { mutate: createAccount } = useCreate();
  const { mutate: createTxn } = useCreate();

  const reset = () => {
    setName("");
    setNotes("");
    setWorkingBalance("");
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    setSubmitting(true);

    createAccount(
      {
        resource: "Account",
        values: { name: name.trim(), notes: notes.trim() || null },
        successNotification: false,
      },
      {
        onSuccess: (created) => {
          const accountId = (created as any)?.data?.id;
          const startingCents = toCents(workingBalance);
          if (!accountId || startingCents === 0) {
            setSubmitting(false);
            reset();
            onCreated?.(accountId);
            onClose();
            return;
          }

          createTxn(
            {
              resource: "AccountTransaction",
              values: {
                accountId,
                date: new Date().toISOString(),
                payeeId: null,
                categoryItemId: null,
                memo: "Starting Balance",
                inflowCents: startingCents > 0 ? startingCents : 0,
                outflowCents: startingCents < 0 ? -startingCents : 0,
                isAdjustment: true,
                cleared: true,
              },
              successNotification: false,
            },
            {
              onSettled: () => {
                setSubmitting(false);
                reset();
                onCreated?.(accountId);
                onClose();
              },
            },
          );
        },
        onError: () => setSubmitting(false),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
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
      <DialogTitle sx={{ fontWeight: 900, pt: 3, px: 4, fontSize: "1.5rem" }}>
        New Account
      </DialogTitle>
      <DialogContent sx={{ px: 4, pb: 2 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3, mt: 2 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12 }}>
              <TextField
                value={name}
                onChange={(e) => setName(e.target.value)}
                label="Account Nickname"
                fullWidth
                autoFocus
                variant="outlined"
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                label="Account Notes"
                fullWidth
                multiline
                minRows={2}
                variant="outlined"
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                value={workingBalance}
                onChange={(e) => setWorkingBalance(e.target.value)}
                label="Starting Balance"
                type="number"
                fullWidth
                variant="outlined"
                slotProps={{ inputLabel: { shrink: true } }}
                helperText="Creates an initial adjustment transaction. Leave blank for $0."
              />
            </Grid>
          </Grid>
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 4, pt: 1 }}>
        <Button
          onClick={handleClose}
          sx={{ fontWeight: 700, color: "text.secondary" }}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disableElevation
          disabled={submitting || !name.trim()}
          startIcon={submitting ? <CircularProgress size={16} /> : null}
          sx={{ px: 4, py: 1, borderRadius: 2, fontWeight: 800 }}
        >
          {submitting ? "Saving..." : "Save Account"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
