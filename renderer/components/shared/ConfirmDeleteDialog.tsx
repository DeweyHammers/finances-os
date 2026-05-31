import { FC, ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
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
          p: 1,
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
    <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />
    <DialogActions sx={{ p: 2, gap: 1 }}>
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
