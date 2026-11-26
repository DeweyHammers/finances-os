"use client";

/**
 * BillTemporaryAmounts — the "Temporary amount" section of the Bill edit
 * dialog (Nov 25 2026).
 *
 * For months when a bill costs something else: a lower payment for a while
 * ("$50 for 3 months"), or $0 while nothing is charged. The user types an
 * amount, steps to the month it starts in and to how many months it lasts;
 * each month becomes one `BillOverride` row. Afterwards the bill is back at
 * its regular amount by itself — there is nothing to undo.
 *
 * ONE temporary amount per bill (user decision, Nov 25 2026 — the first build
 * let several pile up): while the bill has one, the section shows it with a
 * Remove button and no form; the form comes back when it is removed or its
 * months are over. `buildSetBillOverrideOperations` enforces the same thing
 * in the data (a new run replaces whatever the bill has).
 *
 * "Starting" and "For" are steppers (‹ Dec 2026 ›, − 3 months +), not
 * dropdowns: the first build's selects opened 24- and 12-row menus that
 * covered the whole dialog (user feedback, same day). A line under the fields
 * spells out what Add will do before it is pressed.
 *
 * Unlike the fields above it, this section saves RIGHT AWAY (its own "Add"
 * and Remove buttons), not with the dialog's "Update Bill": the rows belong
 * to another table and are written as one batch (lib/batch-api.ts), so a
 * three-month change is never half saved. The batch bypasses Refine, so this
 * component does what a mutation hook would have done: tells the sync
 * indicator, refetches the BillOverride lists, and tells the automatic
 * Optimize that a plan input changed (the plan re-plans itself ~1 s later).
 *
 * See CLAUDE.md → "Temporary bill amounts".
 */

import { useMemo, useState, type ReactNode } from "react";
import { FieldLabel, FormSection, FormSectionNote } from "../shared/FormSection";
import { Box, Button, IconButton, InputAdornment, TextField, Typography } from "@mui/material";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import RemoveIcon from "@mui/icons-material/Remove";
import AddIcon from "@mui/icons-material/Add";
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
  addBillMonths,
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

/**
 * A value with a step-down and a step-up button, in a box that matches the
 * text field beside it: ‹ Dec 2026 › for the month, − 3 months + for the
 * length. Nothing opens, so nothing can cover the dialog.
 */
const Stepper = ({
  value,
  onDown,
  onUp,
  downDisabled,
  upDisabled,
  downLabel,
  upLabel,
  downIcon,
  upIcon,
}: {
  value: string;
  onDown: () => void;
  onUp: () => void;
  downDisabled: boolean;
  upDisabled: boolean;
  /** Accessible names of the two buttons ("Start one month earlier"). */
  downLabel: string;
  upLabel: string;
  downIcon: ReactNode;
  upIcon: ReactNode;
}) => {
  const buttonSx = {
    color: "primary.light",
    borderRadius: 1,
    "&:hover": { bgcolor: "rgba(129, 140, 248, 0.18)" },
    "&.Mui-disabled": { color: "rgba(255,255,255,0.18)" },
  };
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        height: 40,
        px: 0.5,
        borderRadius: 1,
        border: "1px solid rgba(255,255,255,0.23)",
      }}
    >
      {/* type="button": these sit inside the bill's <form>. */}
      <IconButton type="button" size="small" onClick={onDown} disabled={downDisabled} aria-label={downLabel} sx={buttonSx}>
        {downIcon}
      </IconButton>
      <Typography
        // Announced when a step changes it; never wraps, so the box keeps its height.
        aria-live="polite"
        sx={{ flex: 1, minWidth: 0, textAlign: "center", fontWeight: 700, fontSize: "0.9rem", whiteSpace: "nowrap" }}
      >
        {value}
      </Typography>
      <IconButton type="button" size="small" onClick={onUp} disabled={upDisabled} aria-label={upLabel} sx={buttonSx}>
        {upIcon}
      </IconButton>
    </Box>
  );
};

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
  // "Starting" moves between this month and a year from it.
  const lastStartMonth = addBillMonths(thisMonth, BILL_OVERRIDE_START_CHOICES - 1);

  const [amount, setAmount] = useState("");
  const [startMonth, setStartMonth] = useState(() => defaultOverrideStartMonth(new Date(), dueDay));
  const [monthCount, setMonthCount] = useState(3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What the bill has from this month on, as readable runs ("Dec 2026 – Feb
  // 2027"). Normally none or one; earlier months are history and are not
  // shown — once a run's last month is over it disappears here by itself.
  const ranges = useMemo(() => groupBillOverrideRanges(overrides, billId, thisMonth), [overrides, billId, thisMonth]);
  const hasOne = ranges.length > 0;

  const regularText = formatMoney(Math.round(regularAmount * 100));
  const parsedAmount = amount.trim() === "" ? NaN : Number(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount >= 0;
  // The regular amount is not a temporary one: there would be nothing to save.
  const isRegular = amountValid && Math.round(parsedAmount * 100) === Math.round(regularAmount * 100);
  const canAdd = amountValid && !isRegular && !saving;

  const months = billMonthsFrom(startMonth, monthCount);
  const runText = formatBillOverrideRange({ fromMonth: months[0], toMonth: months[months.length - 1] });
  const backText = formatBillMonth(addBillMonths(months[months.length - 1], 1));

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
    if (!canAdd) return;
    await write(
      buildSetBillOverrideOperations({
        billId,
        months,
        amount: parsedAmount,
        regularAmount,
        fromMonth: thisMonth,
        existing: overrides,
      }),
    );
    setAmount("");
  };

  const handleRemove = (ids: string[]) =>
    write(ids.filter(Boolean).map((id) => ({ op: "delete" as const, resource: "BillOverride", id })));

  // ONE card for the whole section (shared/FormSection) — heading,
  // description, fields and the Add strip, or the amount that is set. The
  // heading and description sat ABOVE a card that held only the fields at
  // first, which read as two unrelated things (user feedback, Nov 25 2026).
  // The card is also what separates the section from the bill's own fields
  // above it, so there is no divider line.
  const title = "TEMPORARY AMOUNT (OPTIONAL)";
  const description =
    "For a few months when this bill costs something else: a lower payment, or $0 when nothing is charged. It is saved as soon as you press Add.";
  const errorLine = error && (
    <Typography variant="caption" sx={{ color: "error.main", display: "block", mt: 1.5 }}>
      Could not save: {error}
    </Typography>
  );

  // ── The bill has one: show it, with Remove. No form — one at a time. ──
  if (hasOne) {
    return (
      <FormSection title={title} description={description}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {ranges.map((r) => (
            <Box
              key={`${r.fromMonth}-${r.toMonth}`}
              sx={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 2,
                px: 2,
                py: 1.25,
                borderRadius: 2,
                border: `1px solid ${TOOLTIP_AMBER}55`,
                bgcolor: `${TOOLTIP_AMBER}0f`,
              }}
            >
              <Typography sx={{ fontWeight: 900, color: TOOLTIP_AMBER, fontSize: "1.15rem", whiteSpace: "nowrap" }}>
                {formatMoney(Math.round(r.amount * 100))}
              </Typography>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700, fontSize: "0.9rem", lineHeight: 1.3 }}>
                  {formatBillOverrideRange(r)}
                  {r.months > 1 ? ` · ${r.months} months` : ""}
                </Typography>
                <Typography sx={{ color: "text.secondary", fontSize: "0.75rem", lineHeight: 1.3 }}>
                  Back to {regularText} in {formatBillMonth(addBillMonths(r.toMonth, 1))}
                </Typography>
              </Box>
              <Button
                // type="button": this sits inside the bill's <form>.
                type="button"
                size="small"
                color="inherit"
                aria-label={`Remove the temporary amount for ${formatBillOverrideRange(r)}`}
                onClick={() => handleRemove(r.ids)}
                disabled={saving}
                sx={{ fontWeight: 800, color: "text.secondary", whiteSpace: "nowrap" }}
              >
                Remove
              </Button>
            </Box>
          ))}
          <Typography variant="caption" sx={{ color: "text.disabled", display: "block" }}>
            One at a time: remove it to set a different one. Money already set aside for one of these payments shows
            as extra in the Plan, and Sync Plan hands it back.
          </Typography>
        </Box>
        {errorLine}
      </FormSection>
    );
  }

  // ── None yet: the three fields; in the card's strip, a sentence that says
  //    in words what Add will do, with the button at its right end. The first
  //    stepper layout had the button floating between two paragraphs of small
  //    print ("smashed", user feedback, Nov 25 2026): the strip gives the
  //    button a place of its own. ──
  return (
    <FormSection
      title={title}
      description={description}
      footer={
        <>
          <FormSectionNote>
            {!amountValid ? (
              <Box component="span" sx={{ color: "text.disabled" }}>
                Type an amount to see what will change.
              </Box>
            ) : isRegular ? (
              <Box component="span" sx={{ color: "text.disabled" }}>
                {regularText} is the regular amount, so there is nothing to add.
              </Box>
            ) : (
              <>
                <Box component="span" sx={{ color: TOOLTIP_AMBER, fontWeight: 800 }}>
                  {parsedAmount === 0 ? "Nothing charged" : formatMoney(Math.round(parsedAmount * 100))}
                </Box>{" "}
                for {runText}, then back to {regularText} in {backText}.
              </>
            )}
          </FormSectionNote>
          <Button
            // type="button": this sits inside the bill's <form>.
            type="button"
            // Filled once there is something to add, so it reads as THE action.
            variant="contained"
            disableElevation
            startIcon={<AddIcon />}
            onClick={handleAdd}
            disabled={!canAdd}
            sx={{ height: 38, px: 2.5, fontWeight: 800, borderRadius: 2, whiteSpace: "nowrap", flexShrink: 0 }}
          >
            Add
          </Button>
        </>
      }
    >
      <Box
        sx={{
          display: "grid",
          // Stacked on a phone; three even columns from `sm` up.
          gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(3, minmax(0, 1fr))" },
          gap: 2,
        }}
      >
        <Box>
          <FieldLabel>AMOUNT</FieldLabel>
          <TextField
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
            placeholder="50"
            fullWidth
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
              htmlInput: { inputMode: "decimal", min: 0, step: "any", "aria-label": "Temporary amount" },
            }}
          />
        </Box>
        <Box>
          <FieldLabel>STARTING</FieldLabel>
          <Stepper
            value={formatBillMonth(startMonth)}
            onDown={() => setStartMonth((m) => addBillMonths(m, -1))}
            onUp={() => setStartMonth((m) => addBillMonths(m, 1))}
            downDisabled={startMonth <= thisMonth}
            upDisabled={startMonth >= lastStartMonth}
            downLabel="Start one month earlier"
            upLabel="Start one month later"
            // NavigateBefore / NavigateNext: the Chevron icons are hidden app-wide.
            downIcon={<NavigateBeforeIcon fontSize="small" />}
            upIcon={<NavigateNextIcon fontSize="small" />}
          />
        </Box>
        <Box>
          <FieldLabel>FOR</FieldLabel>
          <Stepper
            value={monthCount === 1 ? "1 month" : `${monthCount} months`}
            onDown={() => setMonthCount((n) => Math.max(1, n - 1))}
            onUp={() => setMonthCount((n) => Math.min(BILL_OVERRIDE_MAX_MONTHS, n + 1))}
            downDisabled={monthCount <= 1}
            upDisabled={monthCount >= BILL_OVERRIDE_MAX_MONTHS}
            downLabel="One month fewer"
            upLabel="One month more"
            downIcon={<RemoveIcon fontSize="small" />}
            upIcon={<AddIcon fontSize="small" />}
          />
        </Box>
      </Box>
      {errorLine}
    </FormSection>
  );
};
