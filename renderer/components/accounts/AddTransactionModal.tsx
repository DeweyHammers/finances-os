"use client";

/**
 * AddTransactionModal — create a new AccountTransaction on the given account.
 *
 * Two modes based on the category picker:
 *  - Normal transaction: write ONE AccountTransaction with the user's inputs.
 *  - Transfer to another account: write TWO paired AccountTransactions (outflow
 *    on this account, inflow on the target) whose memos are prefixed
 *    "Transfer to <name>" / "Transfer from <name>" so AccountLedger can
 *    identify them as transfers instead of regular txns.
 */

import { useEffect, useState } from "react";
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
import { CancelButton } from "../shared/CancelButton";

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
  const { mutateAsync: createTxn } = useCreate();
  const { query: accountsQuery } = useList({
    resource: "Account",
    pagination: { mode: "off" },
  });
  const accounts = (accountsQuery.data?.data as any[]) || [];

  // Reset form when the modal opens so the previous-session values don't
  // pre-fill the next entry. Importantly, don't reset on close — that would
  // make the category/payee/amount visibly flip back to defaults during the
  // close animation.
  useEffect(() => {
    if (open) {
      setState(emptyTransactionState());
      setSubmitting(false);
      setCreatingPayee(false);
    }
  }, [open]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      if (state.transferAccountId) {
        // ── Transfer branch: write two paired transactions atomically ──
        // Uses Promise.allSettled (not Promise.all) so a partial failure still
        // resolves and closes the modal — the user will see whichever side did
        // land on next re-fetch and can reconcile from there.
        const targetAccount = accounts.find(
          (a) => a.id === state.transferAccountId,
        );
        const cents = toCents(state.outflow);
        if (!targetAccount || cents <= 0) {
          setSubmitting(false);
          return;
        }
        const sourceAccount = accounts.find((a) => a.id === accountId);
        // Share one composed ISO across both writes so ledger rows sort/reconcile as a pair.
        const dateIso = composeTransactionDateIso(state.date);

        await Promise.allSettled([
          createTxn({
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
          }),
          createTxn({
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
          }),
        ]);
      } else {
        await createTxn({
          resource: "AccountTransaction",
          values: stateToValues(state, accountId),
          successNotification: false,
        });
      }
    } finally {
      setSubmitting(false);
      onClose();
    }
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
        <CancelButton onClick={handleClose} disabled={submitting} />
        <Button
          onClick={handleSubmit}
          variant="contained"
          disableElevation
          disabled={creatingPayee || submitting}
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
          Save Transaction
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
