"use client";

import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  CircularProgress,
} from "@mui/material";
import { useCreate, useList } from "@refinedev/core";
import { toCents } from "../../lib/cents";
import {
  TransactionFormFields,
  TransactionFormState,
  emptyTransactionState,
  stateToValues,
  composeTransactionDateIso,
} from "./TransactionFormFields";

interface AddTransactionModalProps {
  open: boolean;
  accountId: string;
  onClose: () => void;
}

export const AddTransactionModal = ({
  open,
  accountId,
  onClose,
}: AddTransactionModalProps) => {
  const [state, setState] = useState<TransactionFormState>(
    emptyTransactionState(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [creatingPayee, setCreatingPayee] = useState(false);
  const { mutate: createTxn } = useCreate();
  const { query: accountsQuery } = useList({
    resource: "Account",
    pagination: { mode: "off" },
  });
  const accounts = (accountsQuery.data?.data as any[]) || [];

  const handleClose = () => {
    if (submitting) return;
    setState(emptyTransactionState());
    onClose();
  };

  const handleSubmit = () => {
    setSubmitting(true);

    if (state.transferAccountId) {
      const targetAccount = accounts.find(
        (a) => a.id === state.transferAccountId,
      );
      const cents = toCents(state.outflow);
      if (!targetAccount || cents <= 0) {
        setSubmitting(false);
        return;
      }
      const sourceAccount = accounts.find((a) => a.id === accountId);
      const dateIso = composeTransactionDateIso(state.date);

      let remaining = 2;
      const finalize = () => {
        remaining -= 1;
        if (remaining === 0) {
          setSubmitting(false);
          setState(emptyTransactionState());
          onClose();
        }
      };

      // Outflow on source
      createTxn(
        {
          resource: "AccountTransaction",
          values: {
            accountId,
            date: dateIso,
            payeeId: null,
            categoryItemId: null,
            memo: `Transfer to ${targetAccount.name}${state.memo.trim() ? `: ${state.memo.trim()}` : ""}`,
            inflowCents: 0,
            outflowCents: cents,
            isAdjustment: false,
            cleared: true,
          },
          successNotification: false,
        },
        { onSettled: finalize },
      );

      // Inflow on dest
      createTxn(
        {
          resource: "AccountTransaction",
          values: {
            accountId: state.transferAccountId,
            date: dateIso,
            payeeId: null,
            categoryItemId: null,
            memo: `Transfer from ${sourceAccount?.name ?? "another account"}${state.memo.trim() ? `: ${state.memo.trim()}` : ""}`,
            inflowCents: cents,
            outflowCents: 0,
            isAdjustment: false,
            cleared: true,
          },
          successNotification: false,
        },
        { onSettled: finalize },
      );
      return;
    }

    createTxn(
      {
        resource: "AccountTransaction",
        values: stateToValues(state, accountId),
        successNotification: false,
      },
      {
        onSettled: () => {
          setSubmitting(false);
          setState(emptyTransactionState());
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
        New Transaction
      </DialogTitle>
      <DialogContent sx={{ px: 4, pb: 2 }}>
        <Box sx={{ mt: 2 }}>
          <TransactionFormFields
            accountId={accountId}
            state={state}
            onChange={setState}
            onCreatingChange={setCreatingPayee}
          />
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
          disabled={submitting || creatingPayee}
          startIcon={submitting ? <CircularProgress size={16} /> : null}
          sx={{ px: 4, py: 1, borderRadius: 2, fontWeight: 800 }}
        >
          {submitting ? "Saving..." : "Save Transaction"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
