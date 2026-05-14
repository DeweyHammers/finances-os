"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Tabs,
  Tab,
  Box,
  TextField,
  Autocomplete,
  CircularProgress,
  Chip,
  Typography,
} from "@mui/material";
import { useList, useCreate } from "@refinedev/core";
import { getCycleColor } from "../../lib/cycle-utils";
import { getOrdinal } from "../../lib/date-utils";

interface AddItemModalProps {
  open: boolean;
  groupId: string | null;
  nextSortOrder: number;
  onClose: () => void;
}

type Mode = "BILL" | "PERSONAL_NAME" | "CUSTOM";

export const AddItemModal = ({
  open,
  groupId,
  nextSortOrder,
  onClose,
}: AddItemModalProps) => {
  const [mode, setMode] = useState<Mode>("CUSTOM");
  const [submitting, setSubmitting] = useState(false);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [selectedPersonalName, setSelectedPersonalName] =
    useState<string | null>(null);
  const [customName, setCustomName] = useState("");

  const { query: billsQuery } = useList({
    resource: "Bill",
    pagination: { mode: "off" },
    sorters: [{ field: "name", order: "asc" }],
  });
  const { query: personalsQuery } = useList({
    resource: "Personal",
    pagination: { mode: "off" },
  });
  const { mutate: createItem } = useCreate();

  const bills = (billsQuery.data?.data as any[]) || [];
  const personals = (personalsQuery.data?.data as any[]) || [];

  const distinctPersonalNames = useMemo(() => {
    const seen = new Set<string>();
    personals.forEach((p) => seen.add(p.name));
    return Array.from(seen).sort();
  }, [personals]);

  const personalCyclesForName = useMemo(() => {
    if (!selectedPersonalName) return [];
    return personals
      .filter((p) => p.name === selectedPersonalName)
      .sort((a, b) => a.withdrawalCycle.localeCompare(b.withdrawalCycle));
  }, [personals, selectedPersonalName]);

  useEffect(() => {
    if (open) {
      setMode("CUSTOM");
      setSelectedBillId(null);
      setSelectedPersonalName(null);
      setCustomName("");
      setSubmitting(false);
    }
  }, [open]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = () => {
    if (!groupId) return;
    setSubmitting(true);

    const buildValues = () => {
      if (mode === "BILL") {
        const bill = bills.find((b) => b.id === selectedBillId);
        if (!bill) return null;
        return {
          groupId,
          sortOrder: nextSortOrder,
          name: `${bill.name} ($${Number(bill.amount).toFixed(2)} - ${bill.dueDate}${getOrdinal(bill.dueDate)})`,
          sourceType: "BILL",
          sourceBillId: bill.id,
          sourcePersonalName: null,
          customAmountCents: null,
          customCycle: null,
        };
      }
      if (mode === "PERSONAL_NAME") {
        if (!selectedPersonalName) return null;
        return {
          groupId,
          sortOrder: nextSortOrder,
          name: selectedPersonalName,
          sourceType: "PERSONAL_NAME",
          sourceBillId: null,
          sourcePersonalName: selectedPersonalName,
          customAmountCents: null,
          customCycle: null,
        };
      }
      if (mode === "CUSTOM") {
        if (!customName.trim()) return null;
        return {
          groupId,
          sortOrder: nextSortOrder,
          name: customName.trim(),
          sourceType: "CUSTOM",
          sourceBillId: null,
          sourcePersonalName: null,
          customAmountCents: null,
          customCycle: null,
        };
      }
      return null;
    };

    const values = buildValues();
    if (!values) {
      setSubmitting(false);
      return;
    }

    createItem(
      {
        resource: "BudgetCategoryItem",
        values,
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

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (mode === "BILL") return !!selectedBillId;
    if (mode === "PERSONAL_NAME") return !!selectedPersonalName;
    if (mode === "CUSTOM") return !!customName.trim();
    return false;
  }, [mode, selectedBillId, selectedPersonalName, customName, submitting]);

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
      <DialogTitle sx={{ fontWeight: 900, pt: 3, px: 4 }}>
        New Budget Item
      </DialogTitle>
      <DialogContent sx={{ px: 4, pb: 2 }}>
        <Tabs
          value={mode}
          onChange={(_, v) => setMode(v as Mode)}
          sx={{ mb: 3, mt: 1 }}
        >
          <Tab value="CUSTOM" label="Custom" sx={{ fontWeight: 700 }} />
          <Tab value="BILL" label="From Bills" sx={{ fontWeight: 700 }} />
          <Tab
            value="PERSONAL_NAME"
            label="From Personal"
            sx={{ fontWeight: 700 }}
          />
        </Tabs>

        {mode === "BILL" && (
          <Autocomplete
            options={bills}
            getOptionLabel={(b) => `${b.name} ($${Number(b.amount).toFixed(2)} - ${b.dueDate})`}
            value={bills.find((b) => b.id === selectedBillId) || null}
            onChange={(_, v) => setSelectedBillId(v?.id || null)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Pick a Bill"
                slotProps={{
                  ...(params as any).slotProps,
                  inputLabel: { shrink: true },
                }}
              />
            )}
          />
        )}

        {mode === "PERSONAL_NAME" && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Autocomplete
              options={distinctPersonalNames}
              value={selectedPersonalName}
              onChange={(_, v) => setSelectedPersonalName(v)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Pick a Personal item"
                  slotProps={{
                    ...(params as any).slotProps,
                    inputLabel: { shrink: true },
                  }}
                />
              )}
            />
            {personalCyclesForName.length > 0 && (
              <Box>
                <Typography
                  variant="caption"
                  sx={{ color: "text.secondary", fontWeight: 700 }}
                >
                  Will fund this much per cycle:
                </Typography>
                <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
                  {personalCyclesForName.map((p) => {
                    const c = getCycleColor(p.withdrawalCycle);
                    return (
                      <Chip
                        key={p.id}
                        label={`${p.withdrawalCycle} $${Number(p.amount).toFixed(2)}`}
                        sx={{
                          bgcolor: `${c}20`,
                          color: c,
                          fontWeight: 800,
                          border: `1px solid ${c}40`,
                        }}
                      />
                    );
                  })}
                </Box>
              </Box>
            )}
          </Box>
        )}

        {mode === "CUSTOM" && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <TextField
              label="Name"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              fullWidth
              variant="outlined"
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 4, pt: 1 }}>
        <Button
          onClick={handleClose}
          sx={{ fontWeight: 700 }}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          disableElevation
          onClick={handleSubmit}
          disabled={!canSubmit}
          startIcon={submitting ? <CircularProgress size={16} /> : null}
          sx={{ fontWeight: 800, borderRadius: 2, px: 4 }}
        >
          {submitting ? "Saving..." : "Add Item"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
