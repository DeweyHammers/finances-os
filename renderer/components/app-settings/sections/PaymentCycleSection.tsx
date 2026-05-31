"use client";

import { useState } from "react";
import {
  Box,
  Typography,
  Divider,
  ToggleButton,
  ToggleButtonGroup,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Chip,
  Alert,
} from "@mui/material";
import { useList, useUpdate, useUpdateMany } from "@refinedev/core";
import {
  cyclesRemovedByChange,
  normalizePaymentCycle,
  PaymentCycle,
} from "../../../lib/cycle-utils";
import { CancelButton } from "../../shared/CancelButton";

interface PaymentCycleSectionProps {
  currentValue: string | undefined;
}

const OPTIONS: { value: PaymentCycle; label: string; description: string }[] = [
  {
    value: "WEEKLY",
    label: "Weekly",
    description: "Pay arrives every week. Bills can use Q1, Q2, Q3, or Q4.",
  },
  {
    value: "BI_WEEKLY",
    label: "Bi-Weekly",
    description: "Pay arrives every two weeks. Bills can use Q1 or Q2 only.",
  },
];

interface PendingSnapshot {
  target: PaymentCycle;
  removedCycles: string[];
  affectedBills: any[];
  affectedPersonals: any[];
  affectedItems: any[];
}

export const PaymentCycleSection = ({ currentValue }: PaymentCycleSectionProps) => {
  const current = normalizePaymentCycle(currentValue);
  // pending drives whether a dialog is open. snapshot holds the values we
  // render — captured at open time so they stay stable through the close
  // animation when pending clears (otherwise the counts flash to 0 as the
  // dialog fades out).
  const [pending, setPending] = useState<PaymentCycle | null>(null);
  const [snapshot, setSnapshot] = useState<PendingSnapshot | null>(null);

  const { mutate: updateSettings } = useUpdate();
  const { mutate: updateManyBills } = useUpdateMany();
  const { mutate: updateManyPersonals } = useUpdateMany();
  const { mutate: updateManyItems } = useUpdateMany();

  const { query: billsQuery } = useList({
    resource: "Bill",
    pagination: { mode: "off" },
  });
  const { query: personalsQuery } = useList({
    resource: "Personal",
    pagination: { mode: "off" },
  });
  const { query: itemsQuery } = useList({
    resource: "BudgetCategoryItem",
    pagination: { mode: "off" },
  });

  const bills = (billsQuery.data?.data as any[]) || [];
  const personals = (personalsQuery.data?.data as any[]) || [];
  const items = (itemsQuery.data?.data as any[]) || [];

  const handleChange = (_: unknown, next: PaymentCycle | null) => {
    if (!next || next === current) return;
    const removed = cyclesRemovedByChange(current, next);
    setSnapshot({
      target: next,
      removedCycles: removed,
      affectedBills: bills.filter((b) => removed.includes(b.withdrawalCycle)),
      affectedPersonals: personals.filter((p) =>
        removed.includes(p.withdrawalCycle),
      ),
      affectedItems: items.filter(
        (i) => i.customCycle && removed.includes(i.customCycle),
      ),
    });
    setPending(next);
  };

  const closeDialog = () => setPending(null);
  // Clear the snapshot only after the dialog has fully exited so the content
  // stays rendered through the close animation.
  const handleDialogExited = () => setSnapshot(null);

  const applyChange = () => {
    if (!snapshot) return;
    const { target, affectedBills, affectedPersonals, affectedItems } =
      snapshot;

    if (affectedBills.length > 0) {
      updateManyBills({
        resource: "Bill",
        ids: affectedBills.map((b) => b.id),
        values: { withdrawalCycle: "Q1" },
        successNotification: false,
      });
    }
    if (affectedPersonals.length > 0) {
      updateManyPersonals({
        resource: "Personal",
        ids: affectedPersonals.map((p) => p.id),
        values: { withdrawalCycle: "Q1" },
        successNotification: false,
      });
    }
    if (affectedItems.length > 0) {
      updateManyItems({
        resource: "BudgetCategoryItem",
        ids: affectedItems.map((i) => i.id),
        values: { customCycle: "Q1" },
        successNotification: false,
      });
    }
    updateSettings({
      resource: "AppSettings",
      id: "global",
      values: { paymentCycle: target },
      successNotification: false,
    });
    setPending(null);
  };

  const needsConfirmation =
    pending !== null && (snapshot?.removedCycles.length ?? 0) > 0;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1, fontWeight: 800 }}>
        Payment Cycle
      </Typography>
      <Typography variant="body2" sx={{ mb: 3, color: "text.secondary" }}>
        Tell the app how often you get paid. Bills and personal items will only
        be allowed to use cycles that match this schedule.
      </Typography>
      <Divider sx={{ mb: 3 }} />

      <ToggleButtonGroup
        value={current}
        exclusive
        onChange={handleChange}
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 2,
          width: "100%",
          "& .MuiToggleButton-root": {
            border: "1px solid rgba(129, 140, 248, 0.2)",
            borderRadius: 2,
            textAlign: "left",
            justifyContent: "flex-start",
            alignItems: "flex-start",
            flexDirection: "column",
            p: 2,
            textTransform: "none",
            color: "text.secondary",
            "&.Mui-selected": {
              bgcolor: "rgba(129, 140, 248, 0.15)",
              borderColor: "primary.light",
              color: "white",
              "&:hover": { bgcolor: "rgba(129, 140, 248, 0.2)" },
            },
          },
        }}
      >
        {OPTIONS.map((opt) => (
          <ToggleButton key={opt.value} value={opt.value} aria-label={opt.label}>
            <Typography sx={{ fontWeight: 800, fontSize: "1rem", mb: 0.5 }}>
              {opt.label}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {opt.description}
            </Typography>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Dialog
        open={pending !== null && !needsConfirmation}
        onClose={closeDialog}
        maxWidth="xs"
        fullWidth
        slotProps={{ transition: { onExited: handleDialogExited } as any }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Switch Payment Cycle?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: "text.secondary" }}>
            Change payment cycle to {snapshot?.target}?
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <CancelButton onClick={closeDialog} />
          <Button
            variant="contained"
            onClick={applyChange}
            sx={{ fontWeight: 800 }}
          >
            Switch
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={needsConfirmation}
        onClose={closeDialog}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: {
            sx: { borderRadius: 2, bgcolor: "background.paper", p: 1 },
          },
          transition: { onExited: handleDialogExited } as any,
        }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>
          Heads up — items will be moved to Q1
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
            Switching to{" "}
            <strong>
              {snapshot?.target === "BI_WEEKLY"
                ? "Bi-Weekly"
                : (snapshot?.target ?? "")}
            </strong>{" "}
            drops the following cycles:{" "}
            {(snapshot?.removedCycles ?? []).map((c) => (
              <Chip
                key={c}
                label={c}
                size="small"
                sx={{
                  mx: 0.25,
                  bgcolor: "rgba(244, 63, 94, 0.15)",
                  color: "#fbbf24",
                  fontWeight: 800,
                }}
              />
            ))}
            . Everything currently on those cycles will be moved to{" "}
            <strong>Q1</strong>.
          </Alert>

          <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
            This will move:
          </Typography>
          <Box
            component="ul"
            sx={{
              m: 0,
              pl: 3,
              color: "text.secondary",
              "& li": { mb: 0.5 },
            }}
          >
            <li>
              <strong>{snapshot?.affectedBills.length ?? 0}</strong> bill
              {(snapshot?.affectedBills.length ?? 0) === 1 ? "" : "s"}
            </li>
            <li>
              <strong>{snapshot?.affectedPersonals.length ?? 0}</strong>{" "}
              personal item
              {(snapshot?.affectedPersonals.length ?? 0) === 1 ? "" : "s"}
            </li>
            {(snapshot?.affectedItems.length ?? 0) > 0 && (
              <li>
                <strong>{snapshot?.affectedItems.length ?? 0}</strong> custom
                budget item
                {(snapshot?.affectedItems.length ?? 0) === 1 ? "" : "s"}
              </li>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <CancelButton onClick={closeDialog} />
          <Button
            variant="contained"
            color="warning"
            onClick={applyChange}
            sx={{ fontWeight: 800 }}
          >
            Move to Q1 &amp; Switch
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
