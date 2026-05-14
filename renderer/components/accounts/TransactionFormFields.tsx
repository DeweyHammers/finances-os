"use client";

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

const availableColor = (cents: number): string => {
  if (cents < 0) return "#f43f5e";
  if (cents > 0) return "#3DBC83";
  return "rgba(255,255,255,0.45)";
};

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

  const groups = (groupsQuery.data?.data as any[]) || [];
  const items = (itemsQuery.data?.data as any[]) || [];
  const accounts = (accountsQuery.data?.data as any[]) || [];
  const allMonths = (monthsQuery.data?.data as any[]) || [];
  const allTxns = (txnsQuery.data?.data as any[]) || [];
  const otherAccounts = accounts.filter(
    (a) => a.id !== accountId && !a.closed,
  );

  const availableByItemId = useMemo(() => {
    const target = (() => {
      const d = new Date();
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    })();
    const map = new Map<string, number>();
    items.forEach((i) => {
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

  const grouped = useMemo(() => {
    const byGroup = new Map<string, { groupName: string; items: any[] }>();
    groups.forEach((g) => {
      byGroup.set(g.id, { groupName: g.name, items: [] });
    });
    items.forEach((it) => {
      if (byGroup.has(it.groupId)) {
        byGroup.get(it.groupId)!.items.push(it);
      }
    });
    return Array.from(byGroup.values()).filter((g) => g.items.length > 0);
  }, [groups, items]);

  const selectedValue = state.transferAccountId
    ? `${TRANSFER_PREFIX}${state.transferAccountId}`
    : state.categoryItemId || "";

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
                return item ? item.name : "";
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
          {grouped.flatMap((g) => [
            <ListSubheader
              key={`h-${g.groupName}`}
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
            ...g.items.map((it) => {
              const avail = availableByItemId.get(it.id) ?? 0;
              return (
                <MenuItem
                  key={it.id}
                  value={it.id}
                  sx={{
                    py: 0.85,
                    px: 2,
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
                    {it.name}
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
            }),
          ])}
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

export const emptyTransactionState = (): TransactionFormState => ({
  date: new Date().toISOString().slice(0, 10),
  payeeId: null,
  categoryItemId: null,
  transferAccountId: null,
  memo: "",
  inflow: "",
  outflow: "",
  originalDateIso: undefined,
});

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

export const valuesToState = (txn: any): TransactionFormState => {
  const originalDateIso =
    typeof txn.date === "string"
      ? txn.date
      : new Date(txn.date).toISOString();
  return {
    date: originalDateIso.slice(0, 10),
    payeeId: txn.payeeId || null,
    categoryItemId: txn.categoryItemId || null,
    transferAccountId: null,
    memo: txn.memo || "",
    inflow: txn.inflowCents ? String(fromCents(txn.inflowCents)) : "",
    outflow: txn.outflowCents ? String(fromCents(txn.outflowCents)) : "",
    originalDateIso,
  };
};
