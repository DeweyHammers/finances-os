/**
 * ConfirmDeleteDialog — reusable "are you sure?" confirmation modal.
 *
 * Small controlled Dialog with a title, description, Cancel + destructive
 * confirm button. Used by ResourceList for row deletions and anywhere else the
 * app needs a light-weight confirmation before an irreversible action. Caller
 * owns open state and both handlers.
 *
 * The dialog's outer box has NO padding of its own (it had `p: 1` until Nov 25
 * 2026): the title and the button row are full-width bands now (theme override
 * in app/providers.tsx), and a padded box left a frame of the form colour all
 * around them. The divider above the buttons went with it — the footer band
 * draws that line itself.
 */

import { FC, ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import { CancelButton } from "./CancelButton";

interface ConfirmDeleteDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmDeleteDialog: FC<ConfirmDeleteDialogProps> = ({
  open,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
  onClose,
}) => (
  <Dialog
    open={open}
    onClose={onClose}
    maxWidth="xs"
    fullWidth
    slotProps={{
      paper: {
        sx: {
          borderRadius: 2,
          bgcolor: "background.paper",
          backgroundImage: "none",
        },
      },
    }}
  >
    <DialogTitle sx={{ fontWeight: 800, fontSize: "1.2rem", pb: 1 }}>
      {title}
    </DialogTitle>
    <DialogContent sx={{ pb: 2 }}>
      <DialogContentText sx={{ color: "text.secondary", fontSize: "0.9rem" }}>
        {description}
      </DialogContentText>
    </DialogContent>
    {/* px 3: the buttons end where the title and the text start (24px). */}
    <DialogActions sx={{ px: 3, gap: 1 }}>
      <CancelButton onClick={onClose} size="small" />
      <Button
        onClick={onConfirm}
        variant="contained"
        color="error"
        size="small"
        disableElevation
        sx={{
          px: 2,
          borderRadius: 1.5,
          fontWeight: 700,
          textTransform: "none",
          bgcolor: "error.main",
          "&:hover": { bgcolor: "error.dark" },
        }}
      >
        {confirmLabel}
      </Button>
    </DialogActions>
  </Dialog>
);
