"use client";

/**
 * BillTemporaryAmounts — the "Temporary amount" section of the Bill edit
 * dialog (Nov 25 2026).
 *
 * For months when a bill costs something else: a lower payment for a while
 * ("$50 for 3 months"), or $0 while nothing is charged. The user picks an
 * amount, the month it starts in and how many months it lasts; each month
 * becomes one `BillOverride` row. Afterwards the bill is back at its regular
 * amount by itself — there is nothing to undo.
 *
 * Unlike the fields above it, this section saves RIGHT AWAY (its own "Add"
 * and remove buttons), not with the dialog's "Update Bill": the rows belong
 * to another table and are written as one batch (lib/batch-api.ts), so a
 * three-month change is never half saved. The batch bypasses Refine, so this
 * component does what a mutation hook would have done: tells the sync
 * indicator, refetches the BillOverride lists, and tells the automatic
 * Optimize that a plan input changed (the plan re-plans itself ~1 s later).
 *
 * See CLAUDE.md → "Temporary bill amounts".
 */

import { useMemo, useState } from "react";
import { Box, Button, IconButton, MenuItem, TextField, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useInvalidate, useList } from "@refinedev/core";
import { applyBatch } from "../../lib/batch-api";
import { notifyLocalWrite } from "../../lib/use-connection-status";
import { notifyInputWrite } from "../../lib/auto-optimize";
import { billMonthKey, formatBillMonth } from "../../lib/pay-period-utils";
import { formatMoney } from "../../lib/cents";
import { TOOLTIP_AMBER } from "../../lib/tooltip-styles";
import {
  BILL_OVERRIDE_MAX_MONTHS,
  BILL_OVERRIDE_START_CHOICES,
  billMonthsFrom,
  buildSetBillOverrideOperations,
  defaultOverrideStartMonth,
  formatBillOverrideRange,
  groupBillOverrideRanges,
} from "../../lib/bill-overrides";

interface BillTemporaryAmountsProps {
  billId: string;
  /** The bill's saved regular amount (dollars). */
  regularAmount: number;
  /** The bill's saved due day (1–31) — decides which month is offered first. */
  dueDay: number;
}

export const BillTemporaryAmounts = ({ billId, regularAmount, dueDay }: BillTemporaryAmountsProps) => {
  // Every temporary amount (all bills): a handful of rows at most, and the
  // Overview / Plan read the same list, so one cached query serves them all.
  const { query } = useList({
    resource: "BillOverride",
    pagination: { mode: "off" },
    successNotification: false,
    errorNotification: false,
  });
  const overrides = (query.data?.data as any[]) || [];
  const invalidate = useInvalidate();

  const today = new Date();
  const thisMonth = billMonthKey(today.getFullYear(), today.getMonth());
  const startChoices = useMemo(() => billMonthsFrom(thisMonth, BILL_OVERRIDE_START_CHOICES), [thisMonth]);

  const [amount, setAmount] = useState("");
  const [startMonth, setStartMonth] = useState(() => defaultOverrideStartMonth(new Date(), dueDay));
  const [monthCount, setMonthCount] = useState(3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What is set from this month on, as readable runs ("Dec 2026 – Feb 2027").
  // Earlier months are history and stay as they are.
  const ranges = useMemo(() => groupBillOverrideRanges(overrides, billId, thisMonth), [overrides, billId, thisMonth]);

  const parsedAmount = amount.trim() === "" ? NaN : Number(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount >= 0;

  // One batch → then everything a Refine mutation would have done for us.
  const write = async (operations: ReturnType<typeof buildSetBillOverrideOperations>) => {
    if (operations.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await applyBatch(operations);
      notifyLocalWrite();
      await invalidate({ resource: "BillOverride", invalidates: ["list", "many"] });
      // A plan input changed: the automatic Optimize re-plans around it.
      notifyInputWrite();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!amountValid || saving) return;
    await write(
      buildSetBillOverrideOperations({
        billId,
        months: billMonthsFrom(startMonth, monthCount),
        amount: parsedAmount,
        regularAmount,
        existing: overrides,
      }),
    );
    setAmount("");
  };

  const handleRemove = (ids: string[]) =>
    write(ids.filter(Boolean).map((id) => ({ op: "delete" as const, resource: "BillOverride", id })));

  return (
    <Box sx={{ borderTop: "1px solid rgba(255,255,255,0.08)", pt: 2.5 }}>
      <Typography
        variant="caption"
        sx={{ fontWeight: 700, color: "text.secondary", letterSpacing: 0.5, display: "block" }}
      >
        TEMPORARY AMOUNT (OPTIONAL)
      </Typography>
      <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mb: 2 }}>
        For months when this bill costs something else: a lower payment, or $0 when nothing is charged. Afterwards it
        goes back to {formatMoney(Math.round(regularAmount * 100))} by itself. Saved as soon as you press Add.
      </Typography>

      {/* Amount · starting month · how long · Add. Stacked on a phone. */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1fr) auto" },
          gap: 1.5,
          alignItems: "start",
        }}
      >
        <TextField
          label="Amount"
          type="number"
          size="small"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            // Enter must not submit the bill form around this section.
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="e.g. 50"
          fullWidth
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { inputMode: "decimal", min: 0, step: "any", "aria-label": "Temporary amount" } }}
        />
        <TextField
          select
          label="Starting"
          size="small"
          value={startMonth}
          onChange={(e) => setStartMonth(Number(e.target.value))}
          fullWidth
          slotProps={{ inputLabel: { shrink: true } }}
        >
          {startChoices.map((m) => (
            <MenuItem key={m} value={m}>
              {formatBillMonth(m)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="For"
          size="small"
          value={monthCount}
          onChange={(e) => setMonthCount(Number(e.target.value))}
          fullWidth
          slotProps={{ inputLabel: { shrink: true } }}
        >
          {Array.from({ length: BILL_OVERRIDE_MAX_MONTHS }, (_, i) => i + 1).map((n) => (
            <MenuItem key={n} value={n}>
              {n === 1 ? "1 month" : `${n} months`}
            </MenuItem>
          ))}
        </TextField>
        <Button
          // type="button": this sits inside the bill's <form>.
          type="button"
          variant="outlined"
          onClick={handleAdd}
          disabled={!amountValid || saving}
          sx={{ height: 40, px: 2.5, fontWeight: 800, borderRadius: 2, whiteSpace: "nowrap" }}
        >
          Add
        </Button>
      </Box>

      {startMonth === thisMonth && (
        <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mt: 1 }}>
          Pay weeks that already started keep what they saved for this month&apos;s payment.
        </Typography>
      )}
      {error && (
        <Typography variant="caption" sx={{ color: "error.main", display: "block", mt: 1 }}>
          Could not save: {error}
        </Typography>
      )}

      {ranges.length > 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, mt: 2 }}>
          {ranges.map((r) => (
            <Box
              key={`${r.fromMonth}-${r.toMonth}`}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                pl: 1.5,
                pr: 0.5,
                py: 0.5,
                borderRadius: 2,
                border: `1px solid ${TOOLTIP_AMBER}55`,
                bgcolor: `${TOOLTIP_AMBER}0f`,
              }}
            >
              <Typography sx={{ fontWeight: 800, color: TOOLTIP_AMBER, fontSize: "0.9rem", whiteSpace: "nowrap" }}>
                {formatMoney(Math.round(r.amount * 100))}
              </Typography>
              <Typography sx={{ color: "text.secondary", fontSize: "0.85rem", flex: 1, minWidth: 0 }}>
                {formatBillOverrideRange(r)}
                {r.months > 1 ? ` · ${r.months} months` : ""}
              </Typography>
              <IconButton
                size="small"
                aria-label={`Remove the temporary amount for ${formatBillOverrideRange(r)}`}
                onClick={() => handleRemove(r.ids)}
                disabled={saving}
                sx={{ color: "text.secondary" }}
              >
                <CloseIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
