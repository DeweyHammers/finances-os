"use client";

/**
 * EditTransactionModal — edit an existing AccountTransaction.
 *
 * Fetches the transaction by id, converts it via valuesToState into the shared
 * TransactionFormState, and writes back via useUpdate on save. Unlike Add,
 * this modal does NOT re-derive transfers into paired writes — editing a
 * transfer leg only mutates that one leg.
 */

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  CircularProgress,
} from "@mui/material";
import { useOne, useUpdate, useList } from "@refinedev/core";
import {
  TransactionFormFields,
  TransactionFormState,
  emptyTransactionState,
  stateToValues,
  valuesToState,
} from "./TransactionFormFields";
import { CancelButton } from "../shared/CancelButton";

interface EditTransactionModalProps {
  open: boolean;
  transactionId: string | null;
  accountId: string;
  onClose: () => void;
}

export const EditTransactionModal = ({
  open,
  transactionId,
  accountId,
  onClose,
}: EditTransactionModalProps) => {
  const [state, setState] = useState<TransactionFormState>(
    emptyTransactionState(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [creatingPayee, setCreatingPayee] = useState(false);
  const { mutate: updateTxn } = useUpdate();

  const { query } = useOne({
    resource: "AccountTransaction",
    id: transactionId || "",
    queryOptions: { enabled: !!transactionId && open },
  });

  const { query: accountsQuery } = useList({
    resource: "Account",
    pagination: { mode: "off" },
  });

  // Rehydrate form state whenever the fetched transaction changes.
  // Passing the accounts list lets valuesToState recognize transfer legs by
  // matching the memo suffix against known account names.
  useEffect(() => {
    const data = query.data?.data;
    const accounts = (accountsQuery.data?.data ?? []) as { id: string; name: string }[];
    if (data && open) setState(valuesToState(data, accounts));
  }, [query.data?.data, accountsQuery.data?.data, open]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = () => {
    if (!transactionId || submitting) return;
    setSubmitting(true);
    updateTxn(
      {
        resource: "AccountTransaction",
        id: transactionId,
        values: stateToValues(state, accountId),
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

  if (!transactionId) return null;

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
        Edit Transaction
      </DialogTitle>
      <DialogContent sx={{ px: 4, pb: 2 }}>
        {query.isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ mt: 2 }}>
            <TransactionFormFields
              accountId={accountId}
              state={state}
              onChange={setState}
              onCreatingChange={setCreatingPayee}
            />
          </Box>
        )}
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
