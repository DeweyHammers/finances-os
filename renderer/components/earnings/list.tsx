"use client";

import { useState, useMemo } from "react";
import { useOne, BaseRecord } from "@refinedev/core";
import { GridColDef, GridRenderCellParams } from "@mui/x-data-grid";
import { Typography, Tabs, Tab, Box, CircularProgress } from "@mui/material";
import { EarningCreate } from "./create";
import { EarningEdit } from "./edit";
import { WithdrawalCreate } from "../withdrawals/create";
import { WithdrawalEdit } from "../withdrawals/edit";
import { DeductibleExpenseCreate } from "../deductible-expenses/create";
import { DeductibleExpenseEdit } from "../deductible-expenses/edit";
import { ResourceList } from "../shared/ResourceList";
import { formatDate } from "../../lib/date-utils";

export const EarningList = () => {
  const [tabValue, setTabValue] = useState(0);

  const {
    query: { data: settingsData, isLoading: settingsLoading },
  } = useOne<BaseRecord>({
    resource: "AppSettings",
    id: "global",
  });

  const taxRate = Number(settingsData?.data?.upworkTaxProvisionPercent) || 0;

  const incomeColumns = useMemo<GridColDef[]>(
    () => [
      {
        field: "date",
        headerName: "Date Received",
        flex: 1,
        minWidth: 120,
        renderCell: (params: GridRenderCellParams) => (
          <Typography sx={{ color: "text.secondary", fontSize: "1rem" }}>
            {formatDate(params.value as string)}
          </Typography>
        ),
      },
      {
        field: "amount",
        headerName: "Amount",
        type: "number",
        width: 120,
        renderCell: (params: GridRenderCellParams) => (
          <Typography
            sx={{ fontWeight: 700, color: "success.light", fontSize: "1rem" }}
          >
            ${Number(params.value).toFixed(2)}
          </Typography>
        ),
      },
      {
        field: "description",
        headerName: "Description",
        flex: 2,
        minWidth: 250,
        renderCell: (params: GridRenderCellParams) => (
          <Typography sx={{ color: "text.primary", fontSize: "0.95rem" }}>
            {(params.value as string) || "-"}
          </Typography>
        ),
      },
    ],
    [],
  );

  const withdrawalColumns = useMemo<GridColDef[]>(
    () => [
      {
        field: "date",
        headerName: "Date Withdrawn",
        flex: 1,
        minWidth: 120,
        renderCell: (params: GridRenderCellParams) => (
          <Typography sx={{ color: "text.secondary", fontSize: "1rem" }}>
            {formatDate(params.value as string)}
          </Typography>
        ),
      },
      {
        field: "amount",
        headerName: "Amount",
        type: "number",
        width: 120,
        renderCell: (params: GridRenderCellParams) => (
          <Typography
            sx={{ fontWeight: 700, color: "success.light", fontSize: "1rem" }}
          >
            ${Number(params.value).toFixed(2)}
          </Typography>
        ),
      },
      {
        field: "taxAmount",
        headerName: "Tax Provision",
        width: 140,
        sortable: false,
        renderCell: (params: GridRenderCellParams) => {
          const amount = Number(params.row.amount) || 0;
          const tax = amount * taxRate;
          return (
            <Typography
              sx={{ fontWeight: 700, color: "warning.light", fontSize: "1rem" }}
            >
              ${tax.toFixed(2)}
            </Typography>
          );
        },
      },
      {
        field: "description",
        headerName: "Description",
        flex: 2,
        minWidth: 250,
        renderCell: (params: GridRenderCellParams) => (
          <Typography sx={{ color: "text.primary", fontSize: "0.95rem" }}>
            {(params.value as string) || "-"}
          </Typography>
        ),
      },
    ],
    [taxRate],
  );

  const expenseColumns = useMemo<GridColDef[]>(
    () => [
      {
        field: "date",
        headerName: "Date",
        flex: 1,
        minWidth: 120,
        renderCell: (params: GridRenderCellParams) => (
          <Typography sx={{ color: "text.secondary", fontSize: "1rem" }}>
            {formatDate(params.value as string)}
          </Typography>
        ),
      },
      {
        field: "amount",
        headerName: "Amount",
        type: "number",
        width: 120,
        renderCell: (params: GridRenderCellParams) => (
          <Typography
            sx={{ fontWeight: 700, color: "warning.light", fontSize: "1rem" }}
          >
            ${Number(params.value).toFixed(2)}
          </Typography>
        ),
      },
      {
        field: "description",
        headerName: "Description",
        flex: 2,
        minWidth: 250,
        renderCell: (params: GridRenderCellParams) => (
          <Typography sx={{ color: "text.primary", fontSize: "0.95rem" }}>
            {(params.value as string) || "-"}
          </Typography>
        ),
      },
    ],
    [],
  );

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  if (settingsLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}>
        <CircularProgress size={60} thickness={4} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pt: 3,
      }}
    >
      {/* Centered Header Container to match Table Box alignment */}
      <Box sx={{ width: "100%", maxWidth: 1600, px: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 900, mb: 2 }}>
          UpWork Management
        </Typography>

        <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
          <Tabs
            value={tabValue}
            onChange={handleTabChange}
            aria-label="upwork management tabs"
            sx={{
              "& .MuiTab-root": {
                fontWeight: 700,
                fontSize: "1rem",
                textTransform: "none",
              },
            }}
          >
            <Tab label="Income Log" />
            <Tab label="Withdraw Log" />
            <Tab label="Deductible Expenses" />
          </Tabs>
        </Box>
      </Box>

      <Box sx={{ width: "100%" }}>
        {tabValue === 0 && (
          <ResourceList
            resource="Earning"
            title="UpWork Income Log"
            columns={incomeColumns}
            createModal={EarningCreate}
            editModal={EarningEdit}
            height="calc(100vh - 240px)"
          />
        )}
        {tabValue === 1 && (
          <ResourceList
            resource="Withdrawal"
            title="UpWork Withdraw Log"
            columns={withdrawalColumns}
            createModal={WithdrawalCreate}
            editModal={WithdrawalEdit}
            height="calc(100vh - 240px)"
          />
        )}
        {tabValue === 2 && (
          <ResourceList
            resource="DeductibleExpense"
            title="Deductible Expenses"
            columns={expenseColumns}
            createModal={DeductibleExpenseCreate}
            editModal={DeductibleExpenseEdit}
            height="calc(100vh - 240px)"
          />
        )}
      </Box>
    </Box>
  );
};
