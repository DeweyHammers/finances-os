"use client";

/**
 * IncomePaychecks — the per-week editor under each income on the Income page
 * (Nov 2026): "my hours jump between 32 and 40".
 *
 * Shows the income's paychecks from the current pay week onward as small
 * tiles ("Nov 18 – Nov 24 · $700.00"). Clicking one opens a dialog where that
 * ONE paycheck can be set to different hours / a different amount. The
 * current week (NOW) can be edited too — to correct it to what was really
 * paid — but its dialog carries an amber warning: that paycheck is already
 * paid and the week's bills are locked, so the change only moves the week's
 * income and surplus on the Overview (user decision, Nov 10 2026: it was
 * read-only for a moment, then reopened with the warning). "Show more weeks"
 * / "Show fewer weeks" grow and shrink the list 8 weeks at a time. The result
 * is an `IncomeOverride` row keyed by this income + the payday's date, so it
 * changes exactly that week — never "every week 3" — and everything that
 * counts paychecks (Overview, Plan, Optimize) reads it through the shared
 * helpers in lib/pay-period-utils.ts ("Per-week income overrides").
 *
 * Saving goes through Refine, so the automatic re-plan (lib/auto-optimize.tsx)
 * runs about a second later and moves bills out of a short week by itself.
 * "Use regular amount" deletes the row: no row = the income's regular amount.
 *
 * WHICH WEEK? Pay is a period in arrears: the hours worked Nov 11–17 are in
 * the Nov 18 paycheck, which is pay week "Nov 18 – Nov 24" on the Overview.
 * A tile is a PAYCHECK (headed by its pay week, so it matches the Overview's
 * cards), and it says "Worked Nov 11 – Nov 17" underneath; the dialog's hours
 * field is labelled with those work dates. Without that, "32 hours next
 * week" invites clicking the wrong tile (user clarification, Nov 10 2026).
 *
 * Hours are a convenience, not the source of truth: with "Regular hours" set
 * on the income, typing hours fills in the amount the way a pay stub works
 * (lib/paycheck-estimate.ts): gross pay and taxes scale with the hours, flat
 * deductions such as union dues do not — so a 32-hour week pays a bit less
 * than 80% of a 40-hour one. When the income has taxes or flat deductions
 * entered, the dialog shows that breakdown. The amount stays editable (real
 * withholding is not exactly proportional), and only the saved amount is
 * used in any math.
 */

import { useMemo, useState } from "react";
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useCreate, useDelete, useUpdate } from "@refinedev/core";
import { CancelButton } from "../../shared/CancelButton";
import {
  findIncomeOverride,
  listIncomePaychecks,
  type IncomePaycheck,
} from "../../../lib/pay-period-utils";
import { estimatePaycheck, paycheckBasisOf } from "../../../lib/paycheck-estimate";

/** How many paychecks are listed at first, and how many "Show more" adds. */
const PAGE_SIZE = 8;
/** Amber: the app's colour for "this differs from the plan's default" (tooltip-styles' TOOLTIP_AMBER). */
const CUSTOM_COLOR = "#fbbf24";

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "Nov 18" */
const shortDate = (d: Date) => `${d.toLocaleString("default", { month: "short" })} ${d.getDate()}`;
/** "Nov 18 – Nov 24" (one date when the paycheck covers a single day). */
const rangeLabel = (p: IncomePaycheck) =>
  p.start.getTime() === p.end.getTime() ? shortDate(p.start) : `${shortDate(p.start)} – ${shortDate(p.end)}`;
/** The days whose hours a paycheck pays for: "Nov 11 – Nov 17". */
const workLabel = (p: IncomePaycheck) =>
  p.workStart.getTime() === p.workEnd.getTime() ? shortDate(p.workStart) : `${shortDate(p.workStart)} – ${shortDate(p.workEnd)}`;
/** 32 → "32", 37.5 → "37.5" */
const hoursText = (h: number) => String(Math.round(h * 100) / 100);

interface IncomePaychecksProps {
  /** The Income row (id, name, amount, payDay, paymentCycle, payWeekOffset, baseHours, baseTaxes, baseFlatDeductions). */
  income: any;
  /** Every IncomeOverride row (all incomes) — this component picks its own. */
  overrides: any[];
}

export function IncomePaychecks({ income, overrides }: IncomePaychecksProps) {
  const [count, setCount] = useState(PAGE_SIZE);
  // The paycheck being edited (null = dialog closed) and the dialog's fields.
  // Strings, so a half-typed number ("47.") survives editing.
  const [editing, setEditing] = useState<IncomePaycheck | null>(null);
  const [hours, setHours] = useState("");
  const [amount, setAmount] = useState("");

  const { mutate: createOverride } = useCreate();
  const { mutate: updateOverride } = useUpdate();
  const { mutate: deleteOverride } = useDelete();

  // The regular paycheck: take-home, the hours it is for, and what came out
  // of it (taxes scale with hours, flat deductions don't). All optional
  // except the take-home.
  const basis = useMemo(() => paycheckBasisOf(income), [income]);
  const regularAmount = basis.amount;
  const baseHours = basis.baseHours;
  // Whether there is anything to break down (else it is plain scaling).
  const hasDeductions = (basis.taxes ?? 0) > 0 || (basis.flatDeductions ?? 0) > 0;

  // Paydays come from the income's own schedule — the same rule the planner
  // uses, so the date saved here is the date the planner looks up.
  const paychecks = useMemo(
    () =>
      listIncomePaychecks(
        income,
        { payDay: Number(income.payDay ?? 3), paymentCycle: income.paymentCycle },
        new Date(),
        count,
      ),
    [income, count],
  );

  const overrideFor = (p: IncomePaycheck) => findIncomeOverride(overrides, income.id, p.payDate);
  const editingOverride = editing ? overrideFor(editing) : null;

  const openEditor = (p: IncomePaycheck) => {
    const existing = overrideFor(p);
    setEditing(p);
    setAmount(String(existing ? Number(existing.amount) : regularAmount));
    setHours(
      existing?.hours != null ? hoursText(Number(existing.hours)) : baseHours != null && !existing ? hoursText(baseHours) : "",
    );
  };

  // Typing hours fills the amount (when the income says how many hours its
  // regular amount is for); the amount can still be corrected afterwards.
  const onHoursChange = (value: string) => {
    setHours(value);
    const estimate = value.trim() === "" ? null : estimatePaycheck(basis, Number(value));
    if (estimate) setAmount(String(estimate.takeHome));
  };

  const amountNumber = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isFinite(amountNumber) && amountNumber >= 0;
  const hoursNumber = hours.trim() === "" ? null : Number(hours);
  const hoursValid = hoursNumber === null || (Number.isFinite(hoursNumber) && hoursNumber >= 0);
  // The pay-stub breakdown for the hours typed, shown only when the income
  // has taxes / flat deductions to show. It follows the HOURS field; the
  // amount below may have been corrected by hand since.
  const breakdown = hasDeductions && hoursNumber !== null && hoursValid ? estimatePaycheck(basis, hoursNumber) : null;

  // Notifications off: the section can be mounted twice (see IncomesSection).
  const quiet = { successNotification: false as const };

  const removeOverride = () => {
    if (editingOverride?.id) deleteOverride({ resource: "IncomeOverride", id: editingOverride.id, ...quiet });
    setEditing(null);
  };

  const save = () => {
    if (!editing || !amountValid || !hoursValid) return;
    // Back to the regular paycheck (same amount, and the regular hours or
    // none) → no override at all, so the week isn't marked "custom" for
    // numbers that are not custom.
    const sameAsRegular =
      Math.round(amountNumber * 100) === Math.round(regularAmount * 100) &&
      (hoursNumber === null || (baseHours != null && hoursNumber === baseHours));
    if (sameAsRegular) {
      removeOverride();
      return;
    }
    const values = { incomeId: income.id, payDate: editing.payDate, amount: amountNumber, hours: hoursNumber };
    if (editingOverride?.id) {
      updateOverride({ resource: "IncomeOverride", id: editingOverride.id, values, ...quiet });
    } else {
      createOverride({ resource: "IncomeOverride", values, ...quiet });
    }
    setEditing(null);
  };

  return (
    <Box sx={{ mt: 1.5, pt: 1.5, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <Box sx={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", columnGap: 1.5, mb: 1 }}>
        <Typography
          variant="caption"
          sx={{ fontWeight: 800, color: "text.secondary", letterSpacing: 1, fontSize: "0.65rem", whiteSpace: "nowrap" }}
        >
          UPCOMING PAYCHECKS
        </Typography>
        <Typography variant="caption" sx={{ color: "text.disabled", fontSize: "0.7rem" }}>
          Each paycheck pays for the hours worked the week before it. Click one to change its hours or
          amount — only that paycheck changes.
        </Typography>
      </Box>

      {/* As many 148px+ tiles per row as fit; minmax(0, 1fr) keeps a long
          label from widening its column (CLAUDE.md → "Responsive layout"). */}
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(148px, 100%), 1fr))", gap: 1 }}>
        {paychecks.map((p) => {
          const override = overrideFor(p);
          const paid = override ? Number(override.amount) : regularAmount;
          const shownHours = override ? (override.hours != null ? Number(override.hours) : null) : baseHours;
          const accent = override ? CUSTOM_COLOR : p.isCurrent ? "#818cf8" : null;
          return (
            <ButtonBase
              key={p.payDate}
              onClick={() => openEditor(p)}
              aria-label={`Change the paycheck for ${rangeLabel(p)}`}
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                textAlign: "left",
                px: 1.25,
                py: 1,
                borderRadius: 2,
                border: `1px solid ${accent ? `${accent}66` : "rgba(255,255,255,0.08)"}`,
                bgcolor: override ? "rgba(251,191,36,0.06)" : "rgba(15, 23, 42, 0.45)",
                transition: "border-color 120ms, background-color 120ms",
                "&:hover": { borderColor: accent ?? "rgba(129,140,248,0.5)", bgcolor: "rgba(129,140,248,0.08)" },
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, width: "100%" }}>
                <Typography
                  sx={{ fontSize: "0.6rem", fontWeight: 800, letterSpacing: 0.8, color: "text.disabled", textTransform: "uppercase", whiteSpace: "nowrap" }}
                >
                  {p.start.toLocaleString("default", { month: "short" })} · Week {p.weekOfMonth}
                </Typography>
                {(p.isCurrent || override) && (
                  <Box
                    component="span"
                    sx={{
                      ml: "auto",
                      px: 0.6,
                      borderRadius: 1,
                      fontSize: "0.55rem",
                      fontWeight: 900,
                      letterSpacing: 0.5,
                      lineHeight: 1.6,
                      whiteSpace: "nowrap",
                      color: p.isCurrent ? "#818cf8" : CUSTOM_COLOR,
                      bgcolor: p.isCurrent ? "rgba(129,140,248,0.16)" : "rgba(251,191,36,0.14)",
                    }}
                  >
                    {/* The current week always says NOW; a custom amount on
                        it still shows in amber below. Its dialog warns that
                        the week is already under way. */}
                    {p.isCurrent ? "NOW" : "CUSTOM"}
                  </Box>
                )}
              </Box>
              <Typography sx={{ fontSize: "0.8rem", fontWeight: 700, whiteSpace: "nowrap", mt: 0.25 }}>
                {rangeLabel(p)}
              </Typography>
              <Typography sx={{ fontSize: "0.75rem", whiteSpace: "nowrap", color: "text.secondary" }}>
                <Box component="span" sx={{ fontWeight: 800, color: override ? CUSTOM_COLOR : "success.light" }}>
                  {money(paid)}
                </Box>
                {shownHours != null && ` · ${hoursText(shownHours)} hrs`}
              </Typography>
              {/* Which work week this paycheck is for — the dates the user
                  thinks in when their hours change. */}
              <Typography sx={{ fontSize: "0.65rem", whiteSpace: "nowrap", color: "text.disabled", mt: 0.25 }}>
                Worked {workLabel(p)}
              </Typography>
            </ButtonBase>
          );
        })}
      </Box>

      {/* Grow / shrink the list a page at a time. "Show fewer" appears only
          once the list is longer than the first page. */}
      <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 1, mt: 0.75 }}>
        <Button
          size="small"
          onClick={() => setCount((c) => c + PAGE_SIZE)}
          sx={{ fontWeight: 700, textTransform: "none", fontSize: "0.75rem", color: "text.secondary", whiteSpace: "nowrap" }}
        >
          Show more weeks
        </Button>
        {count > PAGE_SIZE && (
          <Button
            size="small"
            onClick={() => setCount((c) => Math.max(PAGE_SIZE, c - PAGE_SIZE))}
            sx={{ fontWeight: 700, textTransform: "none", fontSize: "0.75rem", color: "text.secondary", whiteSpace: "nowrap" }}
          >
            Show fewer weeks
          </Button>
        )}
      </Box>

      {/* ── One paycheck ── */}
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        fullWidth
        maxWidth="xs"
        transitionDuration={{ enter: 225, exit: 0 }}
        slotProps={{ paper: { sx: { borderRadius: 3, bgcolor: "background.paper", backgroundImage: "none" } } }}
      >
        <DialogTitle sx={{ fontWeight: 900, pt: 3, px: 4, pb: 0.5, fontSize: "1.25rem" }}>
          {editing ? rangeLabel(editing) : ""}
        </DialogTitle>
        <DialogContent sx={{ px: 4, pb: 2 }}>
          {/* Spell out the two date ranges: when it is paid / which pay week
              it is on the Overview, and which days' hours it pays for. */}
          {editing && (
            <Typography variant="body2" sx={{ mb: 0.75 }}>
              Paid {shortDate(editing.start)}, for the hours worked{" "}
              <Box component="span" sx={{ fontWeight: 800, whiteSpace: "nowrap" }}>{workLabel(editing)}</Box>.
            </Typography>
          )}
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 2.5 }}>
            {income.name} · regular paycheck {money(regularAmount)}
            {baseHours != null && ` for ${hoursText(baseHours)} hrs`}
          </Typography>
          {/* Editing the week that is running now: allowed (to record what
              was really paid), but say plainly what it does and doesn't do. */}
          {editing?.isCurrent && (
            <Box
              role="alert"
              sx={{
                display: "flex",
                gap: 1,
                mb: 2.5,
                p: 1.5,
                borderRadius: 2,
                bgcolor: "rgba(251,191,36,0.08)",
                border: "1px solid rgba(251,191,36,0.3)",
              }}
            >
              <WarningAmberIcon sx={{ color: CUSTOM_COLOR, fontSize: 18, mt: 0.1, flexShrink: 0 }} />
              <Typography variant="caption" sx={{ color: "warning.light", lineHeight: 1.5 }}>
                <Box component="span" sx={{ fontWeight: 800 }}>This pay week is already under way.</Box>{" "}
                Its paycheck has been paid and its bills stay where they are. Changing it only changes this
                week&apos;s income and surplus on the Overview. Use it to match what you were really paid.
              </Typography>
            </Box>
          )}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
            <TextField
              label={editing ? `Hours worked ${workLabel(editing)}` : "Hours worked"}
              type="number"
              value={hours}
              onChange={(e) => onHoursChange(e.target.value)}
              // Select the current value on focus: the usual edit is "type
              // the new hours", which then replaces it.
              onFocus={(e) => e.target.select()}
              error={!hoursValid}
              fullWidth
              autoFocus
              helperText={
                baseHours != null
                  ? `Fills in the amount from your regular ${hoursText(baseHours)} hrs.`
                  : "Optional. Set “Regular hours” on this income to have the amount filled in from the hours."
              }
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { inputMode: "decimal", min: 0, step: "any" } }}
            />
            {/* How the estimate for these hours comes about — the same lines
                as a pay stub. Only when the income has taxes or flat
                deductions entered (otherwise it is plain scaling). */}
            {breakdown && (
              <Box
                sx={{
                  mt: -1,
                  px: 1.5,
                  py: 1,
                  borderRadius: 2,
                  bgcolor: "rgba(15, 23, 42, 0.5)",
                  border: "1px solid rgba(129, 140, 248, 0.15)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {[
                  { label: "Gross pay", value: money(breakdown.gross), show: true },
                  { label: "Taxes", value: `− ${money(breakdown.taxes)}`, show: (basis.taxes ?? 0) > 0 },
                  { label: "Dues & fixed deductions", value: `− ${money(breakdown.flatDeductions)}`, show: (basis.flatDeductions ?? 0) > 0 },
                ]
                  .filter((row) => row.show)
                  .map((row) => (
                    <Box key={row.label} sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
                      <Typography sx={{ fontSize: "0.75rem", color: "text.secondary" }}>{row.label}</Typography>
                      <Typography sx={{ fontSize: "0.75rem", color: "text.secondary", whiteSpace: "nowrap" }}>{row.value}</Typography>
                    </Box>
                  ))}
                <Box
                  sx={{ display: "flex", justifyContent: "space-between", gap: 2, mt: 0.5, pt: 0.5, borderTop: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <Typography sx={{ fontSize: "0.78rem", fontWeight: 800 }}>Take-home</Typography>
                  <Typography sx={{ fontSize: "0.78rem", fontWeight: 800, color: "success.light", whiteSpace: "nowrap" }}>
                    {money(breakdown.takeHome)}
                  </Typography>
                </Box>
              </Box>
            )}
            <TextField
              label={editing ? `Paycheck on ${shortDate(editing.start)}` : "Paycheck"}
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              error={!amountValid}
              fullWidth
              helperText="Your take-home for this paycheck. Correct it once you know the real number."
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { inputMode: "decimal", min: 0, step: "any" } }}
            />
            <Typography variant="caption" sx={{ color: "text.disabled", lineHeight: 1.5 }}>
              {editing?.isCurrent
                ? "Only this pay week changes. Nothing is re-planned: the week's bills are already set."
                : "Only this pay week changes. The Overview re-plans its bills around this paycheck by itself."}
            </Typography>
          </Box>
        </DialogContent>
        {/* Wraps on a phone: "Use regular amount" drops under the two main buttons. */}
        <DialogActions sx={{ p: 4, pt: 1, gap: 1, flexWrap: "wrap" }}>
          {editingOverride && (
            <Button
              onClick={removeOverride}
              sx={{ mr: "auto", fontWeight: 700, textTransform: "none", color: "text.secondary", whiteSpace: "nowrap" }}
            >
              Use regular amount
            </Button>
          )}
          <CancelButton onClick={() => setEditing(null)} />
          <Button
            variant="contained"
            disableElevation
            onClick={save}
            disabled={!amountValid || !hoursValid}
            sx={{ px: 4, py: 1, borderRadius: 2, fontWeight: 800 }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
