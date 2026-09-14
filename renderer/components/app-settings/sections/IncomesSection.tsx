"use client";

/**
 * IncomesSection — CRUD editor for the Income resource (embeddable + standalone).
 *
 * Renders a list of income sources with per-row edit/delete plus a modal for
 * add/edit. Mounted inside the AppSettingsModal AND as the standalone /Income
 * route. Exactly one income must be marked Primary — the Primary income's
 * paymentCycle + payDay drive bill grouping and the Plan/Overview pay periods.
 */

import { useState } from "react";
import {
  Box,
  Typography,
  Divider,
  Button,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Switch,
  FormControlLabel,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import StarIcon from "@mui/icons-material/Star";
import { useList, useCreate, useUpdate, useDelete } from "@refinedev/core";
import { CancelButton } from "../../shared/CancelButton";

// ── Constants ──
// Weekday values match JS Date.getDay() convention (0=Sun … 6=Sat). Weekend
// paydays are intentionally omitted — no real-world payroll runs Sat/Sun and
// the pay-period utilities assume a weekday anchor.
const PAY_DAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
];

// Fast value→label lookup used to render each income row's cadence pill.
const PAY_DAY_LABEL: Record<number, string> = Object.fromEntries(
  PAY_DAY_OPTIONS.map((o) => [o.value, o.label]),
);

const CYCLE_OPTIONS = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BI_WEEKLY", label: "Bi-Weekly" },
];

// Local form state — `amount` is stored as string so the raw TextField input
// survives editing (empty, partial decimals, etc.) and is coerced on save.
// `payWeekOffset` only matters for BI_WEEKLY (0 = 1st & 3rd week, 1 = 2nd & 4th).
interface IncomeFormState {
  name: string;
  amount: string;
  paymentCycle: string;
  payDay: number;
  payWeekOffset: number;
  isPrimary: boolean;
}

// Defaults: WEEKLY / Wednesday payday / not primary. `isPrimary` gets flipped
// to true in openAdd() when this is the very first income being created.
const DEFAULT_FORM: IncomeFormState = {
  name: "",
  amount: "",
  paymentCycle: "WEEKLY",
  payDay: 3,
  payWeekOffset: 0,
  isPrimary: false,
};

export const IncomesSection = () => {
  // ── Local UI state ──
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<IncomeFormState>(DEFAULT_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // ── Data ──
  // Sort primary first so it shows at the top of the list with its distinctive
  // border/badge treatment.
  const { query } = useList({
    resource: "Income",
    pagination: { mode: "off" },
    sorters: [{ field: "isPrimary", order: "desc" }],
  });
  const { mutate: createIncome } = useCreate();
  const { mutate: updateIncome } = useUpdate();
  const { mutate: deleteIncome } = useDelete();

  const incomes = (query.data?.data as any[]) ?? [];
  const currentPrimary = incomes.find((i) => i.isPrimary) ?? null;
  const editingIncome = editingId ? incomes.find((i) => i.id === editingId) ?? null : null;

  // Primary switch is locked when: adding the first income (must be primary) or editing the existing primary (can't unset it)
  const isPrimaryLocked =
    (editingId === null && incomes.length === 0) ||
    Boolean(editingIncome?.isPrimary);

  // Warn when promoting a different income to primary
  const showPrimaryWarning =
    form.isPrimary &&
    currentPrimary !== null &&
    (editingId === null || editingIncome?.id !== currentPrimary.id);

  // ── Handlers ──
  // First income created is auto-marked primary — the app REQUIRES exactly one
  // primary income to compute pay periods; we can't let the user save a state
  // with zero.
  const openAdd = () => {
    setEditingId(null);
    setForm({ ...DEFAULT_FORM, isPrimary: incomes.length === 0 });
    setModalOpen(true);
  };

  const openEdit = (income: any) => {
    setEditingId(income.id);
    setForm({
      name: income.name,
      amount: String(income.amount),
      paymentCycle: income.paymentCycle ?? "WEEKLY",
      payDay: Number(income.payDay ?? 3),
      payWeekOffset: Number(income.payWeekOffset ?? 0),
      isPrimary: Boolean(income.isPrimary),
    });
    setModalOpen(true);
  };

  const handleSave = () => {
    // payWeekOffset is only meaningful for BI_WEEKLY. Force to 0 for WEEKLY so
    // stale offsets from a prior bi-weekly cycle don't leak into the record.
    const values = {
      name: form.name.trim(),
      amount: Number(form.amount),
      paymentCycle: form.paymentCycle,
      payDay: form.payDay,
      payWeekOffset: form.paymentCycle === "BI_WEEKLY" ? form.payWeekOffset : 0,
      isPrimary: form.isPrimary,
    };
    // Notifications suppressed because IncomesSection can be mounted twice
    // (settings modal + /Income route) — duplicate Refine toasts would produce
    // React duplicate-key warnings.
    if (editingId) {
      updateIncome({
        resource: "Income",
        id: editingId,
        values,
        successNotification: false,
      });
    } else {
      createIncome({
        resource: "Income",
        values,
        successNotification: false,
      });
    }
    setModalOpen(false);
  };

  const handleDelete = () => {
    if (!deleteId) return;
    deleteIncome({
      resource: "Income",
      id: deleteId,
      successNotification: false,
    });
    setDeleteId(null);
  };

  // Primary income cannot be deleted — the app needs one to compute pay periods.
  // User must first promote another income to primary, then delete this one.
  const canDelete = (income: any) => !income.isPrimary;

  // ── Render ──
  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 1,
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          Income Sources
        </Typography>
        <Button
          startIcon={<AddIcon sx={{ fontSize: 16 }} />}
          onClick={openAdd}
          size="small"
          sx={{ fontWeight: 700, borderRadius: 2 }}
        >
          Add Income
        </Button>
      </Box>
      <Typography variant="body2" sx={{ mb: 3, color: "text.secondary" }}>
        Add each income source. The Primary income sets the pay schedule used
        for bill grouping and the Plan.
      </Typography>
      <Divider sx={{ mb: 3 }} />

      {incomes.length === 0 ? (
        <Box
          sx={{
            py: 5,
            textAlign: "center",
            border: "1px dashed rgba(255,255,255,0.1)",
            borderRadius: 3,
          }}
        >
          <Typography sx={{ color: "text.secondary", mb: 2, fontSize: "0.9rem" }}>
            No income sources yet.
          </Typography>
          <Button
            variant="contained"
            disableElevation
            startIcon={<AddIcon />}
            onClick={openAdd}
            sx={{ fontWeight: 800, borderRadius: 2 }}
          >
            Add Your First Income
          </Button>
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {incomes.map((income: any) => (
            <Box
              key={income.id}
              sx={{
                p: 2,
                borderRadius: 2,
                border: income.isPrimary
                  ? "1px solid rgba(129, 140, 248, 0.4)"
                  : "1px solid rgba(255,255,255,0.08)",
                bgcolor: income.isPrimary
                  ? "rgba(129, 140, 248, 0.07)"
                  : "rgba(255,255,255,0.02)",
                display: "flex",
                alignItems: "center",
                gap: 2,
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box
                  sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}
                >
                  <Typography sx={{ fontWeight: 700, fontSize: "0.95rem" }}>
                    {income.name}
                  </Typography>
                  {income.isPrimary && (
                    <Chip
                      label="PRIMARY"
                      size="small"
                      icon={<StarIcon sx={{ fontSize: "0.7rem !important" }} />}
                      sx={{
                        height: 20,
                        fontSize: "0.65rem",
                        fontWeight: 900,
                        letterSpacing: 0.5,
                        bgcolor: "rgba(129, 140, 248, 0.15)",
                        color: "primary.light",
                        border: "1px solid rgba(129, 140, 248, 0.3)",
                        "& .MuiChip-icon": { color: "primary.light" },
                      }}
                    />
                  )}
                </Box>
                <Box
                  sx={{
                    display: "flex",
                    gap: 1.5,
                    alignItems: "center",
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ color: "success.light", fontWeight: 700 }}
                  >
                    ${Number(income.amount).toFixed(2)}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.disabled" }}>
                    ·
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {income.paymentCycle === "BI_WEEKLY" ? "Bi-Weekly" : "Weekly"}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.disabled" }}>
                    ·
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {PAY_DAY_LABEL[Number(income.payDay)] ?? `Day ${income.payDay}`}
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>
                <IconButton
                  size="small"
                  onClick={() => openEdit(income)}
                  sx={{ color: "primary.light" }}
                >
                  <EditIcon sx={{ fontSize: 16 }} />
                </IconButton>
                {canDelete(income) && (
                  <IconButton
                    size="small"
                    onClick={() => setDeleteId(income.id)}
                    sx={{ color: "error.light" }}
                  >
                    <DeleteIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* ── Add / Edit Modal ── */}
      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        fullWidth
        maxWidth="sm"
        transitionDuration={{ enter: 225, exit: 0 }}
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
        <DialogTitle
          sx={{ fontWeight: 900, pt: 3, px: 4, fontSize: "1.4rem" }}
        >
          {editingId ? "Edit Income" : "Add Income"}
        </DialogTitle>
        <DialogContent sx={{ px: 4, pb: 2 }}>
          <Box
            sx={{ display: "flex", flexDirection: "column", gap: 3, mt: 2 }}
          >
            <TextField
              label="Name"
              value={form.name}
              onChange={(e) =>
                setForm((f) => ({ ...f, name: e.target.value }))
              }
              fullWidth
              placeholder="e.g. My Paycheck, Spouse"
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Amount per period"
              type="number"
              value={form.amount}
              onChange={(e) =>
                setForm((f) => ({ ...f, amount: e.target.value }))
              }
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />

            <Box>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 700,
                  color: "text.secondary",
                  letterSpacing: 0.5,
                  mb: 1,
                  display: "block",
                }}
              >
                PAYMENT CYCLE
              </Typography>
              <ToggleButtonGroup
                value={form.paymentCycle}
                exclusive
                onChange={(_, v) =>
                  v && setForm((f) => ({ ...f, paymentCycle: v }))
                }
                sx={{
                  width: "100%",
                  "& .MuiToggleButton-root": {
                    flex: 1,
                    border: "1px solid rgba(129,140,248,0.2)",
                    fontWeight: 700,
                    textTransform: "none",
                    color: "text.secondary",
                    "&.Mui-selected": {
                      bgcolor: "rgba(129,140,248,0.15)",
                      borderColor: "primary.light",
                      color: "white",
                    },
                  },
                }}
              >
                {CYCLE_OPTIONS.map((o) => (
                  <ToggleButton key={o.value} value={o.value}>
                    {o.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>

            <Box>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 700,
                  color: "text.secondary",
                  letterSpacing: 0.5,
                  mb: 1,
                  display: "block",
                }}
              >
                PAY DAY
              </Typography>
              <ToggleButtonGroup
                value={form.payDay}
                exclusive
                onChange={(_, v) =>
                  v != null && setForm((f) => ({ ...f, payDay: v }))
                }
                sx={{
                  display: "flex",
                  gap: 1,
                  "& .MuiToggleButton-root": {
                    flex: 1,
                    border: "1px solid rgba(129,140,248,0.2)",
                    borderRadius: 2,
                    fontWeight: 700,
                    textTransform: "none",
                    color: "text.secondary",
                    "&.Mui-selected": {
                      bgcolor: "rgba(129,140,248,0.15)",
                      borderColor: "primary.light",
                      color: "white",
                    },
                  },
                }}
              >
                {PAY_DAY_OPTIONS.map((o) => (
                  <ToggleButton key={o.value} value={o.value}>
                    {o.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>

            {form.paymentCycle === "BI_WEEKLY" && (
              <Box>
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 700,
                    color: "text.secondary",
                    letterSpacing: 0.5,
                    mb: 1,
                    display: "block",
                  }}
                >
                  WHICH WEEKS
                </Typography>
                <ToggleButtonGroup
                  value={form.payWeekOffset}
                  exclusive
                  onChange={(_, v) =>
                    v != null && setForm((f) => ({ ...f, payWeekOffset: v }))
                  }
                  sx={{
                    width: "100%",
                    "& .MuiToggleButton-root": {
                      flex: 1,
                      border: "1px solid rgba(129,140,248,0.2)",
                      fontWeight: 700,
                      textTransform: "none",
                      color: "text.secondary",
                      "&.Mui-selected": {
                        bgcolor: "rgba(129,140,248,0.15)",
                        borderColor: "primary.light",
                        color: "white",
                      },
                    },
                  }}
                >
                  <ToggleButton value={0}>1st & 3rd</ToggleButton>
                  <ToggleButton value={1}>2nd & 4th</ToggleButton>
                </ToggleButtonGroup>
              </Box>
            )}

            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.isPrimary}
                    disabled={isPrimaryLocked}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, isPrimary: e.target.checked }))
                    }
                    color="primary"
                  />
                }
                label={
                  <Box sx={{ ml: 0.5 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: "0.9rem" }}>
                      Set as Primary
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ color: "text.secondary", display: "block" }}
                    >
                      {isPrimaryLocked
                        ? "This income is the primary and cannot be unset. To change the primary, edit another income."
                        : "This income's pay schedule drives bill grouping and the Plan."}
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: "flex-start", mt: 0.5 }}
              />
              {showPrimaryWarning && (
                <Box
                  sx={{
                    mt: 1.5,
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: "rgba(251,191,36,0.08)",
                    border: "1px solid rgba(251,191,36,0.25)",
                  }}
                >
                  <Typography variant="caption" sx={{ color: "warning.light", fontWeight: 700 }}>
                    Heads up: saving will make this the new primary and remove primary status from "{currentPrimary?.name}".
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 4, pt: 1 }}>
          <CancelButton onClick={() => setModalOpen(false)} />
          <Button
            variant="contained"
            disableElevation
            onClick={handleSave}
            disabled={!form.name.trim() || !form.amount}
            sx={{ px: 4, py: 1, borderRadius: 2, fontWeight: 800 }}
          >
            {editingId ? "Update Income" : "Add Income"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Confirmation ── */}
      <Dialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        maxWidth="xs"
        fullWidth
        transitionDuration={{ enter: 225, exit: 0 }}
        slotProps={{
          paper: {
            sx: { borderRadius: 3, bgcolor: "background.paper", backgroundImage: "none" },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, pt: 3, px: 4 }}>
          Remove Income?
        </DialogTitle>
        <DialogContent sx={{ px: 4 }}>
          <Typography sx={{ color: "text.secondary" }}>
            This income source will be permanently removed.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 4, pt: 1, gap: 1 }}>
          <CancelButton onClick={() => setDeleteId(null)} />
          <Button
            variant="contained"
            color="error"
            disableElevation
            onClick={handleDelete}
            sx={{ fontWeight: 800, borderRadius: 2 }}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
