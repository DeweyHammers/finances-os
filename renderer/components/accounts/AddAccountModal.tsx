"use client";

/**
 * AddAccountModal — create a new Account (checking, savings, credit, etc).
 *
 * Two-step create when a non-zero starting balance is entered:
 *  1. Create the Account row.
 *  2. Create a matching "Starting Balance" AccountTransaction (isAdjustment=true,
 *     cleared=true) so the ledger opens with the correct opening amount.
 * If balance is $0 or blank, step 2 is skipped and only the account is created.
 */

import { useEffect, useState } from "react";
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
import { CancelButton } from "../shared/CancelButton";

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

  // Reset on open only — never on close/save — so typed values don't visibly
  // flip back to empty during the close animation.
  useEffect(() => {
    if (open) {
      setName("");
      setNotes("");
      setWorkingBalance("");
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
          // Skip the starting-balance txn when nothing was entered — a $0
          // adjustment row would just be clutter in the ledger.
          if (!accountId || startingCents === 0) {
            setSubmitting(false);
            onCreated?.(accountId);
            onClose();
            return;
          }

          // Negative starting balance (credit card debt, overdraft) is
          // recorded as an outflow so the running balance ends up negative.
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
        <CancelButton onClick={handleClose} disabled={submitting} />
        <Button
          onClick={handleSubmit}
          variant="contained"
          disableElevation
          disabled={!name.trim() || submitting}
          sx={{
            px: 4,
            py: 1,
            borderRadius: 2,
            fontWeight: 800,
            position: "relative",
            ...(submitting && {
              "&.Mui-disabled": {
                bgcolor: "primary.main",
              },
            }),
          }}
        >
          Save Account
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
