"use client";

/**
 * EditAccountModal — edit an existing Account or close it entirely.
 *
 * Name/notes updates are straightforward. Working-balance changes trigger a
 * "Manual Balance Adjustment" AccountTransaction (built via buildBalanceAdjustment)
 * so the running balance matches the new target without touching historical
 * transactions. Delete is a two-click confirm to avoid accidental account removal.
 */

import { useState, useEffect } from "react";
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
  Divider,
  Typography,
} from "@mui/material";
import {
  useOne,
  useList,
  useUpdate,
  useCreate,
  useDelete,
} from "@refinedev/core";
import { toCents, fromCents } from "../../lib/cents";
import {
  computeAccountBalance,
  buildBalanceAdjustment,
} from "../../lib/budget-utils";
import { CancelButton } from "../shared/CancelButton";

interface EditAccountModalProps {
  open: boolean;
  accountId: string | null;
  onClose: () => void;
}

export const EditAccountModal = ({
  open,
  accountId,
  onClose,
}: EditAccountModalProps) => {
  const { query: accountQuery } = useOne({
    resource: "Account",
    id: accountId || "",
    queryOptions: { enabled: !!accountId && open },
  });
  const { query: txnsQuery } = useList({
    resource: "AccountTransaction",
    filters: [{ field: "accountId", operator: "eq", value: accountId }],
    pagination: { mode: "off" },
    queryOptions: { enabled: !!accountId && open },
  });
  const { mutate: updateAccount } = useUpdate();
  const { mutate: createTxn } = useCreate();
  const { mutate: deleteAccount } = useDelete();

  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [workingBalance, setWorkingBalance] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const account = accountQuery.data?.data as any;
  const transactions = (txnsQuery.data?.data as any[]) || [];
  const currentBalanceCents = computeAccountBalance(transactions);

  // Populate local state from the fetched account. Also re-runs when
  // currentBalanceCents changes (e.g., a background txn write) so the working
  // balance field mirrors the true balance until the user edits it.
  useEffect(() => {
    if (account && open) {
      setName(account.name || "");
      setNotes(account.notes || "");
      setWorkingBalance(String(fromCents(currentBalanceCents)));
    }
  }, [account, open, currentBalanceCents]);

  const handleClose = () => {
    if (submitting) return;
    setConfirmDelete(false);
    onClose();
  };

  const handleSubmit = () => {
    if (!accountId || !name.trim() || submitting) return;
    setSubmitting(true);

    updateAccount(
      {
        resource: "Account",
        id: accountId,
        values: { name: name.trim(), notes: notes.trim() || null },
        successNotification: false,
      },
      {
        onSuccess: () => {
          // Only write an adjustment if the balance actually changed.
          // buildBalanceAdjustment returns null when current == new, so we
          // skip the txn write and just close.
          const newCents = toCents(workingBalance);
          const adjustment = buildBalanceAdjustment({
            accountId,
            currentBalanceCents,
            newBalanceCents: newCents,
          });
          if (!adjustment) {
            setSubmitting(false);
            onClose();
            return;
          }
          createTxn(
            {
              resource: "AccountTransaction",
              values: {
                ...adjustment,
                date: new Date().toISOString(),
                memo: "Manual Balance Adjustment",
              },
              successNotification: false,
            },
            {
              onSettled: () => {
                setSubmitting(false);
                onClose();
              },
            },
          );
        },
        onError: () => setSubmitting(false),
      },
    );
  };

  const handleDelete = () => {
    if (!accountId || submitting) return;
    setSubmitting(true);
    deleteAccount(
      { resource: "Account", id: accountId, successNotification: false },
      {
        onSettled: () => {
          setSubmitting(false);
          setConfirmDelete(false);
          onClose();
        },
      },
    );
  };

  if (!accountId) return null;

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
        Edit Account
      </DialogTitle>
      <DialogContent sx={{ px: 4, pb: 2 }}>
        {accountQuery.isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box
            sx={{ display: "flex", flexDirection: "column", gap: 3, mt: 2 }}
          >
            <Typography
              variant="overline"
              sx={{ fontWeight: 800, color: "text.secondary" }}
            >
              Account Information
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12 }}>
                <TextField
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  label="Account Nickname"
                  fullWidth
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
            </Grid>

            <Divider />

            <Grid container spacing={2}>
              <Grid size={{ xs: 12 }}>
                <TextField
                  value={workingBalance}
                  onChange={(e) => setWorkingBalance(e.target.value)}
                  label="Working Balance"
                  type="number"
                  fullWidth
                  variant="outlined"
                  slotProps={{ inputLabel: { shrink: true } }}
                  helperText="An adjustment transaction will be created automatically if you change this amount."
                />
              </Grid>
            </Grid>
          </Box>
        )}
      </DialogContent>
      <DialogActions
        sx={{ p: 4, pt: 1, justifyContent: "space-between" }}
      >
        {/* Two-click delete confirmation: first click flips the button label
            and reveals a red Delete button on the right side. Prevents a stray
            click from wiping the account. */}
        <Button
          onClick={() => setConfirmDelete(true)}
          color="error"
          variant="outlined"
          disabled={submitting}
          sx={{ fontWeight: 700 }}
        >
          {confirmDelete ? "Click again to confirm delete" : "Close Account"}
        </Button>
        <Box sx={{ display: "flex", gap: 1 }}>
          <CancelButton onClick={handleClose} disabled={submitting} />
          {confirmDelete ? (
            <Button
              onClick={handleDelete}
              variant="contained"
              color="error"
              disableElevation
              disabled={submitting}
              sx={{
                px: 4,
                py: 1,
                borderRadius: 2,
                fontWeight: 800,
                position: "relative",
                ...(submitting && {
                  "&.Mui-disabled": {
                    bgcolor: "error.main",
                  },
                }),
              }}
            >
              Delete
              {submitting && (
                <CircularProgress
                  size={16}
                  sx={{ position: "absolute", right: 12, color: "inherit" }}
                />
              )}
            </Button>
          ) : (
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
              Save
              {submitting && (
                <CircularProgress
                  size={16}
                  sx={{ position: "absolute", right: 12, color: "inherit" }}
                />
              )}
            </Button>
          )}
        </Box>
      </DialogActions>
    </Dialog>
  );
};
