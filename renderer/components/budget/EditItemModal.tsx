"use client";

/**
 * EditItemModal — the pencil on a Plan envelope.
 *
 * Only a CUSTOM item can be renamed here. An item that comes from a Bill or
 * from Personal entries is SYNCED: the Plan shows the source's live name
 * (`resolveItemDisplay` → `liveName`), never the item's own stored `name`. The
 * dialog used to let the user type a new name for those too and save it — the
 * save went through and nothing changed on screen, with a helper text claiming
 * the edit "overrides the auto-sync" (it never did). Since Nov 25 2026 (user
 * decision) the name of a synced item is read-only here: the field is locked,
 * the note says where the name is managed, and the only action is a shortcut
 * to that page. Amounts and cycles were never editable here.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  TextField,
  Alert,
  CircularProgress,
  InputAdornment,
} from "@mui/material";
import LockIcon from "@mui/icons-material/Lock";
import { useUpdate } from "@refinedev/core";
import { useRouter } from "next/navigation";
import type { BudgetItem } from "./BudgetTable";
import { CancelButton } from "../shared/CancelButton";

interface EditItemModalProps {
  open: boolean;
  item: BudgetItem | null;
  onClose: () => void;
}

export const EditItemModal = ({ open, item, onClose }: EditItemModalProps) => {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { mutate: update } = useUpdate();
  const router = useRouter();

  useEffect(() => {
    if (open && item) {
      setName(item.name);
      setSubmitting(false);
    }
  }, [open, item]);

  if (!item) return null;

  const isCustom = item.sourceType === "CUSTOM";
  const isBill = item.sourceType === "BILL";
  // Bill and Personal items follow their source: the name is not editable.
  const isSynced = !isCustom;
  // Where a synced item's name is managed.
  const source = isBill ? { page: "Bills", route: "/Bill" } : { page: "Personal", route: "/Personal" };

  const handleSave = () => {
    // A synced name is never written from here (see the header comment).
    if (isSynced || !name.trim() || submitting) return;
    setSubmitting(true);
    update(
      {
        resource: "BudgetCategoryItem",
        id: item.id,
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

  const openSourcePage = () => {
    onClose();
    router.push(source.route);
  };

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
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
      <DialogTitle sx={{ fontWeight: 900, pt: 3, px: 4 }}>
        {isSynced ? "Budget Item" : "Edit Budget Item"}
      </DialogTitle>
      <DialogContent sx={{ px: 4, pb: 2 }}>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            mt: 1,
          }}
        >
          {isSynced && (
            <Alert severity="info" variant="outlined">
              {isBill
                ? "This item comes from a Bill. Its name, amount and due day are managed on the Bills page and stay in sync here."
                : "This item comes from your Personal entries. Its name and amount are managed on the Personal page and stay in sync here."}
            </Alert>
          )}
          <TextField
            label={isSynced ? "Name" : "Display Name"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            variant="outlined"
            // Locked for a synced item: shown, never typed into.
            disabled={isSynced}
            slotProps={{
              inputLabel: { shrink: true },
              input: isSynced
                ? {
                    endAdornment: (
                      <InputAdornment position="end">
                        <LockIcon sx={{ fontSize: 18, color: "text.disabled" }} />
                      </InputAdornment>
                    ),
                  }
                : undefined,
            }}
            // No helper text: the banner above already says where the name
            // is managed (a second line repeating it was removed the same day).
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 4, pt: 1 }}>
        {isSynced ? (
          // Nothing to save: close, or jump to where the name is managed.
          <>
            <CancelButton onClick={onClose}>Close</CancelButton>
            <Button
              variant="contained"
              disableElevation
              onClick={openSourcePage}
              sx={{ fontWeight: 800, borderRadius: 2, px: 4, whiteSpace: "nowrap" }}
            >
              Open {source.page}
            </Button>
          </>
        ) : (
          <>
            <CancelButton onClick={onClose} disabled={submitting} />
            <Button
              variant="contained"
              disableElevation
              onClick={handleSave}
              disabled={!name.trim() || submitting}
              sx={{
                fontWeight: 800,
                borderRadius: 2,
                px: 4,
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
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};
