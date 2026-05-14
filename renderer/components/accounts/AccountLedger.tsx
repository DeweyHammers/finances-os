"use client";

import { useMemo, useState } from "react";
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  InputAdornment,
} from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import { useOne, useList, useDelete } from "@refinedev/core";
import { computeAccountBalance } from "../../lib/budget-utils";
import { formatMoney } from "../../lib/cents";
import { formatDate } from "../../lib/date-utils";
import { AddTransactionModal } from "./AddTransactionModal";
import { EditTransactionModal } from "./EditTransactionModal";

interface AccountLedgerProps {
  accountId: string;
}

export const AccountLedger = ({ accountId }: AccountLedgerProps) => {
  const { query: accountQuery } = useOne({
    resource: "Account",
    id: accountId,
  });
  const { query: txnsQuery } = useList({
    resource: "AccountTransaction",
    filters: [{ field: "accountId", operator: "eq", value: accountId }],
    pagination: { mode: "off" },
    sorters: [{ field: "date", order: "desc" }],
  });
  const { query: payeesQuery } = useList({
    resource: "Payee",
    pagination: { mode: "off" },
  });
  const { query: itemsQuery } = useList({
    resource: "BudgetCategoryItem",
    pagination: { mode: "off" },
  });
  const { mutate: deleteMutate } = useDelete();

  const [addOpen, setAddOpen] = useState(false);
  const [editTxnId, setEditTxnId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const account = accountQuery.data?.data as any;
  const transactions = (txnsQuery.data?.data as any[]) || [];
  const payees = (payeesQuery.data?.data as any[]) || [];
  const items = (itemsQuery.data?.data as any[]) || [];

  const balance = useMemo(
    () => computeAccountBalance(transactions),
    [transactions],
  );
  const cleared = useMemo(
    () =>
      computeAccountBalance(transactions.filter((t) => t.cleared !== false)),
    [transactions],
  );
  const uncleared = balance - cleared;

  const payeeName = (id: string | null) =>
    payees.find((p) => p.id === id)?.name || "";
  const itemName = (id: string | null) =>
    items.find((i) => i.id === id)?.name || "";

  const filteredTransactions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter((t) => {
      const payee = t.isAdjustment
        ? "Manual Balance Adjustment"
        : payeeName(t.payeeId);
      const liveCat = t.categoryItemId ? itemName(t.categoryItemId) : "";
      const category =
        liveCat || (t.categoryName as string) || "Ready to Assign";
      const outflowStr =
        t.outflowCents > 0
          ? `${formatMoney(t.outflowCents)} ${formatMoney(t.outflowCents).replace(/[$,]/g, "")}`
          : "";
      const inflowStr =
        t.inflowCents > 0
          ? `${formatMoney(t.inflowCents)} ${formatMoney(t.inflowCents).replace(/[$,]/g, "")}`
          : "";
      return [payee, category, t.memo || "", outflowStr, inflowStr]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [search, transactions, payees, items]);

  const columns = useMemo<GridColDef[]>(
    () => [
      {
        field: "date",
        headerName: "Date",
        width: 130,
        renderCell: (p) => (
          <Typography sx={{ fontSize: "0.95rem", color: "text.secondary" }}>
            {formatDate(p.value)}
          </Typography>
        ),
      },
      {
        field: "payeeId",
        headerName: "Payee",
        flex: 1,
        minWidth: 180,
        renderCell: (p) => (
          <Typography
            sx={{ fontWeight: 600, color: "white", fontSize: "0.95rem" }}
          >
            {p.row.isAdjustment ? "Manual Balance Adjustment" : payeeName(p.value)}
          </Typography>
        ),
      },
      {
        field: "categoryItemId",
        headerName: "Category",
        flex: 1,
        minWidth: 160,
        renderCell: (p) => {
          const liveName = p.value ? itemName(p.value) : "";
          const snapshot = (p.row.categoryName as string | undefined) || "";
          const isDeleted = !p.value && !!snapshot;
          const label = liveName || snapshot || "Ready to Assign";
          return (
            <Typography
              sx={{
                color: isDeleted ? "text.disabled" : "text.secondary",
                fontSize: "0.95rem",
                fontStyle: isDeleted ? "italic" : "normal",
              }}
              title={isDeleted ? "Category item was deleted" : undefined}
            >
              {label}
              {isDeleted ? " (deleted)" : ""}
            </Typography>
          );
        },
      },
      {
        field: "memo",
        headerName: "Memo",
        flex: 1,
        minWidth: 140,
        renderCell: (p) => (
          <Typography sx={{ color: "text.secondary", fontSize: "0.9rem" }}>
            {p.value || ""}
          </Typography>
        ),
      },
      {
        field: "outflowCents",
        headerName: "Outflow",
        width: 120,
        align: "right",
        headerAlign: "right",
        renderCell: (p) => (
          <Typography
            sx={{
              fontWeight: 700,
              color: p.value > 0 ? "#f43f5e" : "text.disabled",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {p.value > 0 ? formatMoney(p.value) : ""}
          </Typography>
        ),
      },
      {
        field: "inflowCents",
        headerName: "Inflow",
        width: 120,
        align: "right",
        headerAlign: "right",
        renderCell: (p) => (
          <Typography
            sx={{
              fontWeight: 700,
              color: p.value > 0 ? "#3DBC83" : "text.disabled",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {p.value > 0 ? formatMoney(p.value) : ""}
          </Typography>
        ),
      },
      {
        field: "actions",
        headerName: "",
        sortable: false,
        width: 100,
        align: "right",
        headerAlign: "right",
        renderCell: (params) => (
          <Box sx={{ display: "flex", gap: 0.5 }}>
            <IconButton
              size="small"
              onClick={() => setEditTxnId(params.row.id)}
              sx={{ color: "primary.light" }}
            >
              <EditIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => setDeleteId(params.row.id)}
              sx={{ color: "error.light" }}
            >
              <DeleteIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        ),
      },
    ],
    [payees, items],
  );

  if (accountQuery.isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!account) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography>Account not found.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, height: "100%", display: "flex", flexDirection: "column" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 3,
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 900, color: "white" }}>
            {account.name}
          </Typography>
          <Box sx={{ display: "flex", gap: 4, mt: 1 }}>
            <Box>
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", fontWeight: 700 }}
              >
                CLEARED
              </Typography>
              <Typography
                sx={{ fontWeight: 800, color: "white", fontSize: "1.1rem" }}
              >
                {formatMoney(cleared)}
              </Typography>
            </Box>
            <Box>
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", fontWeight: 700 }}
              >
                UNCLEARED
              </Typography>
              <Typography
                sx={{ fontWeight: 800, color: "white", fontSize: "1.1rem" }}
              >
                {formatMoney(uncleared)}
              </Typography>
            </Box>
            <Box>
              <Typography
                variant="caption"
                sx={{ color: "primary.light", fontWeight: 700 }}
              >
                WORKING BALANCE
              </Typography>
              <Typography
                sx={{
                  fontWeight: 900,
                  color: "primary.light",
                  fontSize: "1.1rem",
                }}
              >
                {formatMoney(balance)}
              </Typography>
            </Box>
          </Box>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setAddOpen(true)}
          sx={{ fontWeight: 800, borderRadius: 2, px: 3 }}
        >
          Add Transaction
        </Button>
      </Box>

      <Paper
        sx={{
          flex: 1,
          bgcolor: "rgba(15, 23, 42, 0.5)",
          border: "1px solid rgba(255,255,255,0.05)",
          borderRadius: 2,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            px: 2,
            py: 1.25,
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            bgcolor: "rgba(255,255,255,0.015)",
            flexShrink: 0,
          }}
        >
          <TextField
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search payee, category, memo, or amount"
            size="small"
            variant="outlined"
            fullWidth
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon
                      sx={{ color: "text.secondary", fontSize: 18 }}
                    />
                  </InputAdornment>
                ),
                endAdornment: search ? (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={() => setSearch("")}
                      aria-label="Clear search"
                      sx={{ color: "text.secondary" }}
                    >
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              },
            }}
            sx={{
              maxWidth: 460,
              "& .MuiOutlinedInput-root": {
                bgcolor: "rgba(15, 23, 42, 0.6)",
                borderRadius: 1.5,
                fontSize: "0.9rem",
                "& fieldset": { border: "none" },
                "&:hover fieldset": { border: "none" },
                "&.Mui-focused fieldset": { border: "none" },
              },
              "& .MuiOutlinedInput-input": { px: 0.5 },
            }}
          />
          {search.trim() && (
            <Typography
              sx={{
                fontSize: "0.8rem",
                color: "text.secondary",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {filteredTransactions.length} of {transactions.length}
            </Typography>
          )}
        </Box>
        <DataGrid
          rows={filteredTransactions}
          columns={columns}
          disableRowSelectionOnClick
          disableColumnMenu
          rowHeight={56}
          initialState={{
            sorting: { sortModel: [{ field: "date", sort: "desc" }] },
          }}
          sx={{
            border: "none",
            "& .MuiDataGrid-columnSeparator": { display: "none" },
            "& .MuiDataGrid-columnHeaders": {
              bgcolor: "rgba(255,255,255,0.02)",
              fontSize: "0.8rem",
              fontWeight: 800,
              textTransform: "uppercase",
            },
            "& .MuiDataGrid-cell": {
              borderBottom: "1px solid rgba(255,255,255,0.02)",
              display: "flex",
              alignItems: "center",
            },
          }}
        />
      </Paper>

      <AddTransactionModal
        open={addOpen}
        accountId={accountId}
        onClose={() => setAddOpen(false)}
      />
      <EditTransactionModal
        open={!!editTxnId}
        transactionId={editTxnId}
        accountId={accountId}
        onClose={() => setEditTxnId(null)}
      />
      <Dialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete transaction?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure? This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => {
              if (deleteId) {
                deleteMutate({
                  resource: "AccountTransaction",
                  id: deleteId,
                  successNotification: false,
                });
              }
              setDeleteId(null);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
