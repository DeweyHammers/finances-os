"use client";

/**
 * TransactionFormFields — shared form body for Add/Edit Transaction modals.
 *
 * Handles date, payee (via PayeeAutocomplete), category-or-transfer picker,
 * memo, and inflow/outflow amount. Also exports the state shape + helpers used
 * by both modals to convert between TransactionFormState ↔ Prisma AccountTransaction
 * values. Category dropdown mirrors the Plan-page hierarchy (groups → subsections
 * → items) and shows the "available" cents on the right so users can spot
 * empty categories without leaving the modal.
 */

import { useMemo } from "react";
import {
  TextField,
  Grid,
  MenuItem,
  ListSubheader,
  Box,
  Typography,
} from "@mui/material";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import { useList } from "@refinedev/core";
import { PayeeAutocomplete } from "../payees/PayeeAutocomplete";
import { toCents, fromCents, formatMoney } from "../../lib/cents";
import {
  computeActivity,
  computeAvailable,
  monthStart,
} from "../../lib/budget-utils";
import { resolveItemDisplay } from "../../lib/budget-display";

// Color-code the "available" amount shown next to each category in the picker.
// Red = overspent, green = has funds, dim white = exactly zero.
const availableColor = (cents: number): string => {
  if (cents < 0) return "#f43f5e";
  if (cents > 0) return "#3DBC83";
  return "rgba(255,255,255,0.45)";
};

// Sentinel prefix used inside the single Category <TextField select> to
// distinguish transfer picks ("__transfer:<accountId>") from real category
// item picks (raw item id). Kept as a constant so any consumer that needs to
// parse a picked value doesn't have to hardcode the string.
export const TRANSFER_PREFIX = "__transfer:";

export interface TransactionFormState {
  date: string;
  payeeId: string | null;
  categoryItemId: string | null;
  // When set, indicates a transfer to another account; uses TRANSFER_PREFIX + accountId.
  transferAccountId: string | null;
  memo: string;
  inflow: string;
  outflow: string;
  // Original full ISO when editing, so we can preserve the existing time-of-day
  // when the user didn't change the date. Undefined for new transactions.
  originalDateIso?: string;
}

// Picks the timestamp to persist:
//  - editing + unchanged date  → keep original ISO (preserves time of entry)
//  - otherwise (new, or date changed) → use the selected date + current time-of-day,
//    so newly-added rows sort to the top of same-day rows.
export const composeTransactionDateIso = (
  dateInput: string,
  originalIso?: string,
): string => {
  if (dateInput.length > 10) return dateInput;
  if (originalIso && originalIso.slice(0, 10) === dateInput.slice(0, 10)) {
    return originalIso;
  }
  const nowTime = new Date().toISOString().slice(11);
  return `${dateInput}T${nowTime}`;
};

interface TransactionFormFieldsProps {
  accountId: string;
  state: TransactionFormState;
  onChange: (next: TransactionFormState) => void;
  onCreatingChange?: (creating: boolean) => void;
}

export const TransactionFormFields = ({
  accountId,
  state,
  onChange,
  onCreatingChange,
}: TransactionFormFieldsProps) => {
  const set = (patch: Partial<TransactionFormState>) =>
    onChange({ ...state, ...patch });

  const { query: groupsQuery } = useList({
    resource: "BudgetCategoryGroup",
    pagination: { mode: "off" },
    sorters: [{ field: "sortOrder", order: "asc" }],
  });
  const { query: itemsQuery } = useList({
    resource: "BudgetCategoryItem",
    pagination: { mode: "off" },
    sorters: [{ field: "sortOrder", order: "asc" }],
  });
  const { query: subsectionsQuery } = useList({
    resource: "BudgetCategorySubsection",
    pagination: { mode: "off" },
    sorters: [{ field: "sortOrder", order: "asc" }],
  });
  const { query: accountsQuery } = useList({
    resource: "Account",
    pagination: { mode: "off" },
    sorters: [{ field: "sortOrder", order: "asc" }],
  });
  const { query: monthsQuery } = useList({
    resource: "BudgetMonth",
    pagination: { mode: "off" },
  });
  const { query: txnsQuery } = useList({
    resource: "AccountTransaction",
    pagination: { mode: "off" },
  });
  const { query: billsQuery } = useList({
    resource: "Bill",
    pagination: { mode: "off" },
  });
  const { query: personalsQuery } = useList({
    resource: "Personal",
    pagination: { mode: "off" },
  });

  const groups = (groupsQuery.data?.data as any[]) || [];
  const items = (itemsQuery.data?.data as any[]) || [];
  const subsections = (subsectionsQuery.data?.data as any[]) || [];
  const accounts = (accountsQuery.data?.data as any[]) || [];
  const allMonths = (monthsQuery.data?.data as any[]) || [];
  const allTxns = (txnsQuery.data?.data as any[]) || [];
  const bills = (billsQuery.data?.data as any[]) || [];
  const personals = (personalsQuery.data?.data as any[]) || [];
  const otherAccounts = accounts.filter(
    (a) => a.id !== accountId && !a.closed,
  );

  // ── Per-category "available" cumulative balance as of the current month ──
  // Replicates the YNAB "available" calculation used on the Plan page so the
  // dropdown's right-side number matches what the user sees there. For each
  // item, walks month-by-month from the earliest assigned month up to today,
  // rolling forward: available = prior + assigned - activity.
  const availableByItemId = useMemo(() => {
    // Target = first day of current month (UTC, aligned to how BudgetMonth stores dates).
    const target = (() => {
      const d = new Date();
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    })();
    const map = new Map<string, number>();
    items.forEach((i) => {
      // Determine the earliest month to start summing from. If no BudgetMonth
      // rows exist for this item, start at target so we skip the loop entirely.
      const dates = allMonths
        .filter((m) => m.categoryItemId === i.id)
        .map((m) => new Date(m.month));
      const earliest =
        dates.length === 0
          ? target
          : (() => {
              const min = dates.reduce((a, b) => (a < b ? a : b));
              return min < target ? min : target;
            })();
      let cumulative = 0;
      let cursor = monthStart(earliest);
      // Roll forward month-by-month accumulating the running available balance.
      while (cursor.getTime() <= target.getTime()) {
        const a =
          allMonths.find(
            (m) =>
              m.categoryItemId === i.id &&
              new Date(m.month).getTime() === cursor.getTime(),
          )?.assignedCents || 0;
        const act = computeActivity(allTxns, i.id, cursor);
        cumulative = computeAvailable({
          priorAvailable: cumulative,
          assignedCents: a,
          activityCents: act,
        });
        cursor = new Date(
          Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
        );
      }
      map.set(i.id, cumulative);
    });
    return map;
  }, [items, allMonths, allTxns]);

  // Build a nested group → rows structure that interleaves direct items and
  // subsections by sortOrder, so the dropdown matches the Plan order
  // (Bills → Personal → Extra Costs etc.) instead of the global-sortOrder
  // scramble.
  type GroupedRow =
    | { kind: "item"; item: any }
    | { kind: "subsection"; subsection: any; items: any[] };
  interface GroupedSection {
    groupId: string;
    groupName: string;
    rows: GroupedRow[];
  }
  const grouped: GroupedSection[] = useMemo(() => {
    const itemsByGroup = new Map<string, any[]>();
    const itemsBySub = new Map<string, any[]>();
    items.forEach((it) => {
      if (it.subsectionId) {
        const arr = itemsBySub.get(it.subsectionId) ?? [];
        arr.push(it);
        itemsBySub.set(it.subsectionId, arr);
      } else {
        const arr = itemsByGroup.get(it.groupId) ?? [];
        arr.push(it);
        itemsByGroup.set(it.groupId, arr);
      }
    });
    // Each list is already sorted by sortOrder (asc) because the source query
    // sorts by sortOrder — but sortOrder is scoped to its container, so we
    // must re-sort within each container.
    itemsByGroup.forEach((arr) =>
      arr.sort((a, b) => a.sortOrder - b.sortOrder),
    );
    itemsBySub.forEach((arr) =>
      arr.sort((a, b) => a.sortOrder - b.sortOrder),
    );

    const subsByGroup = new Map<string, any[]>();
    subsections.forEach((s) => {
      const arr = subsByGroup.get(s.groupId) ?? [];
      arr.push(s);
      subsByGroup.set(s.groupId, arr);
    });

    return groups
      .map((g) => {
        const directItems = itemsByGroup.get(g.id) ?? [];
        const groupSubs = subsByGroup.get(g.id) ?? [];
        const rows: (GroupedRow & { sortOrder: number })[] = [
          ...directItems.map((item) => ({
            kind: "item" as const,
            item,
            sortOrder: item.sortOrder,
          })),
          ...groupSubs.map((sub) => ({
            kind: "subsection" as const,
            subsection: sub,
            items: itemsBySub.get(sub.id) ?? [],
            sortOrder: sub.sortOrder,
          })),
        ];
        rows.sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.kind === "item" ? -1 : 1;
        });
        return {
          groupId: g.id,
          groupName: g.name,
          rows: rows.map(({ sortOrder, ...row }) => {
            void sortOrder;
            return row as GroupedRow;
          }),
        };
      })
      .filter(
        (g) =>
          g.rows.length > 0 &&
          g.rows.some(
            (r) =>
              r.kind === "item" ||
              (r.kind === "subsection" && r.items.length > 0),
          ),
      );
  }, [groups, items, subsections]);

  const resolveItemLabel = (it: any): string =>
    resolveItemDisplay(
      {
        name: it.name,
        sourceType: it.sourceType,
        sourceBillId: it.sourceBillId,
        sourcePersonalName: it.sourcePersonalName,
        customCycle: it.customCycle,
      },
      bills,
      personals,
    ).displayName;

  const selectedValue = state.transferAccountId
    ? `${TRANSFER_PREFIX}${state.transferAccountId}`
    : state.categoryItemId || "";

  // Single onChange handles all three category-picker outcomes:
  //  - "" → Ready to Assign (inflow allowed)
  //  - "__transfer:<id>" → transfer (force outflow)
  //  - "<itemId>" → normal category (force outflow)
  const handleCategoryChange = (raw: string) => {
    if (raw === "") {
      set({ categoryItemId: null, transferAccountId: null });
      return;
    }
    if (raw.startsWith(TRANSFER_PREFIX)) {
      const targetId = raw.slice(TRANSFER_PREFIX.length);
      // Transfers are inherently outflows on this account; clear inflow.
      set({
        categoryItemId: null,
        transferAccountId: targetId,
        inflow: "",
      });
      return;
    }
    // Regular category selected — outflow only; clear inflow.
    set({
      categoryItemId: raw,
      transferAccountId: null,
      inflow: "",
    });
  };

  // Only "Ready to Assign / Uncategorized" allows an inflow amount — every
  // other choice implies outflow. This drives which amount field renders below.
  const isInflowMode =
    !state.categoryItemId && !state.transferAccountId;

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          value={state.date.slice(0, 10)}
          onChange={(e) => set({ date: e.target.value })}
          label="Date"
          type="date"
          fullWidth
          variant="outlined"
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <PayeeAutocomplete
          value={state.payeeId}
          onChange={(payeeId) => set({ payeeId })}
          onCreatingChange={onCreatingChange}
          size="medium"
        />
      </Grid>
      <Grid size={{ xs: 12 }}>
        <TextField
          value={selectedValue}
          onChange={(e) => handleCategoryChange(e.target.value)}
          select
          label="Category"
          fullWidth
          variant="outlined"
          slotProps={{
            inputLabel: { shrink: true },
            select: {
              displayEmpty: true,
              renderValue: (v) => {
                const val = v as string;
                if (!val)
                  return (
                    <Box
                      component="span"
                      sx={{
                        fontStyle: "italic",
                        color: "#fbbf24",
                        fontWeight: 600,
                      }}
                    >
                      Ready to Assign / Uncategorized
                    </Box>
                  );
                if (val.startsWith(TRANSFER_PREFIX)) {
                  const targetId = val.slice(TRANSFER_PREFIX.length);
                  const a = accounts.find((x) => x.id === targetId);
                  return a ? `Transfer to ${a.name}` : "";
                }
                const item = items.find((x) => x.id === val);
                return item ? resolveItemLabel(item) : "";
              },
              MenuProps: {
                slotProps: {
                  paper: {
                    sx: {
                      maxHeight: 420,
                      mt: 0.5,
                      bgcolor: "#1e293b",
                      backgroundImage: "none",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 2,
                      "& .MuiList-root": { py: 0 },
                    },
                  },
                },
              },
            },
          }}
          helperText={
            state.transferAccountId
              ? "Money moved to another account."
              : state.categoryItemId
              ? "Outflow against this budget category."
              : "Leave blank for an inflow that funds Ready-to-Assign."
          }
        >
          <MenuItem
            value=""
            sx={{
              py: 1,
              px: 2,
              "&:hover": { bgcolor: "rgba(251, 191, 36, 0.08)" },
            }}
          >
            <Typography
              sx={{
                fontStyle: "italic",
                color: "#fbbf24",
                fontWeight: 700,
                fontSize: "0.9rem",
              }}
            >
              Ready to Assign / Uncategorized
            </Typography>
          </MenuItem>
          {otherAccounts.length > 0 && (
            <ListSubheader
              sx={{
                bgcolor: "#1e293b",
                top: 0,
                zIndex: 2,
                color: "rgba(255,255,255,0.45)",
                fontWeight: 700,
                fontSize: "0.75rem",
                letterSpacing: 0.5,
                textTransform: "uppercase",
                lineHeight: 1.5,
                pt: 1.25,
                pb: 0.25,
                px: 2,
              }}
            >
              Transfers
            </ListSubheader>
          )}
          {otherAccounts.map((a) => (
            <MenuItem
              key={a.id}
              value={`${TRANSFER_PREFIX}${a.id}`}
              sx={{
                py: 0.85,
                px: 2,
                "&:hover": { bgcolor: "rgba(129, 140, 248, 0.08)" },
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  width: "100%",
                }}
              >
                <SwapHorizIcon
                  sx={{ fontSize: 16, color: "rgba(255,255,255,0.5)" }}
                />
                <Typography
                  sx={{ color: "white", fontWeight: 500, fontSize: "0.9rem" }}
                >
                  Transfer to {a.name}
                </Typography>
              </Box>
            </MenuItem>
          ))}
          {grouped.flatMap((g) => {
            const renderItemMenu = (it: any, indent: boolean) => {
              const avail = availableByItemId.get(it.id) ?? 0;
              return (
                <MenuItem
                  key={it.id}
                  value={it.id}
                  sx={{
                    py: 0.85,
                    pl: indent ? 4 : 2,
                    pr: 2,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 2,
                    alignItems: "center",
                    "&:hover": { bgcolor: "rgba(129, 140, 248, 0.08)" },
                  }}
                >
                  <Typography
                    sx={{
                      color: "white",
                      fontWeight: 500,
                      fontSize: "0.9rem",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {resolveItemLabel(it)}
                  </Typography>
                  <Typography
                    sx={{
                      color: availableColor(avail),
                      fontWeight: 700,
                      fontSize: "0.85rem",
                      fontVariantNumeric: "tabular-nums",
                      flexShrink: 0,
                    }}
                  >
                    {formatMoney(avail)}
                  </Typography>
                </MenuItem>
              );
            };
            return [
              <ListSubheader
                key={`h-${g.groupId}`}
                sx={{
                  bgcolor: "#1e293b",
                  top: 0,
                  zIndex: 2,
                  color: "rgba(255,255,255,0.45)",
                  fontWeight: 700,
                  fontSize: "0.75rem",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  lineHeight: 1.5,
                  pt: 1.25,
                  pb: 0.25,
                  px: 2,
                }}
              >
                {g.groupName}
              </ListSubheader>,
              ...g.rows.flatMap((row) => {
                if (row.kind === "item") {
                  return [renderItemMenu(row.item, false)];
                }
                if (row.items.length === 0) return [];
                return [
                  <ListSubheader
                    key={`sh-${row.subsection.id}`}
                    sx={{
                      bgcolor: "#1e293b",
                      top: 0,
                      zIndex: 1,
                      color: "primary.light",
                      fontWeight: 700,
                      fontSize: "0.7rem",
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                      lineHeight: 1.5,
                      pt: 0.75,
                      pb: 0.25,
                      pl: 3,
                      pr: 2,
                    }}
                  >
                    {row.subsection.name}
                  </ListSubheader>,
                  ...row.items.map((it: any) => renderItemMenu(it, true)),
                ];
              }),
            ];
          })}
        </TextField>
      </Grid>
      <Grid size={{ xs: 12 }}>
        <TextField
          value={state.memo}
          onChange={(e) => set({ memo: e.target.value })}
          label="Memo"
          fullWidth
          variant="outlined"
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Grid>
      {isInflowMode ? (
        <Grid size={{ xs: 12 }}>
          <TextField
            value={state.inflow}
            onChange={(e) =>
              set({ inflow: e.target.value, outflow: "" })
            }
            label="Inflow"
            type="number"
            fullWidth
            variant="outlined"
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Grid>
      ) : (
        <Grid size={{ xs: 12 }}>
          <TextField
            value={state.outflow}
            onChange={(e) =>
              set({ outflow: e.target.value, inflow: "" })
            }
            label="Outflow"
            type="number"
            fullWidth
            variant="outlined"
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Grid>
      )}
    </Grid>
  );
};

// Today's date in LOCAL YYYY-MM-DD (not UTC).
// Using new Date().toISOString().slice(0,10) would show yesterday's date for
// users east of UTC late at night — this keeps the date field aligned with
// the user's clock.
const todayLocalIsoDate = (): string => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

// Initial state used when opening the Add modal (or resetting the Edit modal
// before data arrives). Everything blank + today's date.
export const emptyTransactionState = (): TransactionFormState => ({
  date: todayLocalIsoDate(),
  payeeId: null,
  categoryItemId: null,
  transferAccountId: null,
  memo: "",
  inflow: "",
  outflow: "",
  originalDateIso: undefined,
});

// Serialize form state to the Prisma AccountTransaction shape.
// Always sets isAdjustment=false + cleared=true because the modal only
// produces user-entered rows (adjustments are created programmatically by
// Add/Edit Account flows, not here).
export const stateToValues = (
  state: TransactionFormState,
  accountId: string,
) => ({
  accountId,
  date: composeTransactionDateIso(state.date, state.originalDateIso),
  payeeId: state.payeeId,
  categoryItemId: state.categoryItemId,
  memo: state.memo.trim() || null,
  inflowCents: toCents(state.inflow),
  outflowCents: toCents(state.outflow),
  isAdjustment: false,
  cleared: true,
});

// Inverse of stateToValues — used by EditTransactionModal to hydrate form
// state from an existing row. Extra work: when a row looks like a transfer
// (no category + memo prefixed "Transfer to "), parse the target account name
// out of the memo and match it to a real account so the picker shows the
// transfer option instead of "Ready to Assign".
export const valuesToState = (
  txn: any,
  accounts?: { id: string; name: string }[],
): TransactionFormState => {
  const originalDateIso =
    typeof txn.date === "string"
      ? txn.date
      : new Date(txn.date).toISOString();
  const memo = txn.memo || "";
  let transferAccountId: string | null = null;
  if (!txn.categoryItemId && accounts?.length && memo.startsWith("Transfer to ")) {
    // Memo shape: "Transfer to <accountName>" or "Transfer to <accountName>: <userMemo>"
    // Slice off the "Transfer to " prefix, then split on ": " to isolate the name.
    const rest = memo.slice("Transfer to ".length);
    const accountName = rest.includes(": ") ? rest.slice(0, rest.indexOf(": ")) : rest;
    const match = accounts.find((a) => a.name === accountName);
    if (match) transferAccountId = match.id;
  }
  return {
    date: originalDateIso.slice(0, 10),
    payeeId: txn.payeeId || null,
    categoryItemId: txn.categoryItemId || null,
    transferAccountId,
    memo,
    inflow: txn.inflowCents ? String(fromCents(txn.inflowCents)) : "",
    outflow: txn.outflowCents ? String(fromCents(txn.outflowCents)) : "",
    originalDateIso,
  };
};
