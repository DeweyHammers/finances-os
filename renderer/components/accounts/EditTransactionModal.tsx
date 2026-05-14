"use client";

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
import { useOne, useUpdate } from "@refinedev/core";
import {
  TransactionFormFields,
  TransactionFormState,
  emptyTransactionState,
  stateToValues,
  valuesToState,
} from "./TransactionFormFields";

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

  useEffect(() => {
    const data = query.data?.data;
    if (data && open) setState(valuesToState(data));
  }, [query.data?.data, open]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = () => {
    if (!transactionId) return;
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
