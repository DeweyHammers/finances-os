"use client";

import { useState, useMemo } from "react";
import { useList, BaseRecord, useOne } from "@refinedev/core";
import {
  Box,
  Typography,
  Paper,
  Grid,
  CircularProgress,
  Select,
  MenuItem,
  FormControl,
} from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { COLORS, MONTHS } from "../../lib/constants";
import { DashboardCard } from "../dashboard/DashboardCard";

export const TaxesList = () => {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const { query: contractsQuery } = useList<BaseRecord>({
    resource: "Contract",
    pagination: { mode: "off" },
  });

  const { query: deductibleExpensesQuery } = useList<BaseRecord>({
    resource: "DeductibleExpense",
    pagination: { mode: "off" },
  });

  const { query: settingsQuery } = useOne<BaseRecord>({
    resource: "AppSettings",
    id: "global",
  });

  const isLoading =
    contractsQuery.isLoading ||
    settingsQuery.isLoading ||
    deductibleExpensesQuery.isLoading;

  const data = useMemo(() => {
    if (!contractsQuery.data?.data)
      return {
        contracts: [],
        totals: {
          gross: 0,
          net: 0,
          fees: 0,
          otherDeductibles: 0,
          totalDeductibles: 0,
          tax: 0,
          expenseHold: 0,
        },
        monthlyBreakdown: [],
      };

    const settings = settingsQuery.data?.data || {};
    const taxProvisionRate = Number(settings.upworkTaxProvisionPercent) || 0;
    const expenseHold = Number(settings.upworkExpensesHoldAmount) || 0;

    let totalGross = 0;
    let totalNet = 0;
    let totalOtherDeductibles = 0;

    // Initialize monthly breakdown
    const monthlyMap: Record<
      number,
      { gross: number; net: number; fees: number; otherDeductibles: number }
    > = {};
    for (let i = 0; i < 12; i++) {
      monthlyMap[i] = { gross: 0, net: 0, fees: 0, otherDeductibles: 0 };
    }

    // Process each contract's entries
    (contractsQuery.data.data as any[]).forEach((c) => {
      const entries = c.entries || [];
      entries.forEach((e: any) => {
        const entryDate = new Date(e.date);
        if (entryDate.getFullYear() === selectedYear) {
          const gross = Number(e.grossPay) || 0;
          const net = Number(e.netPay) || 0;
          const entryMonth = entryDate.getMonth();

          totalGross += gross;
          totalNet += net;

          monthlyMap[entryMonth].gross += gross;
          monthlyMap[entryMonth].net += net;
          monthlyMap[entryMonth].fees += gross - net;
        }
      });
    });

    // Process other deductible expenses
    (deductibleExpensesQuery.data?.data || []).forEach((d: any) => {
      const expenseDate = new Date(d.date);
      if (expenseDate.getFullYear() === selectedYear) {
        const amount = Number(d.amount) || 0;
        const month = expenseDate.getMonth();
        totalOtherDeductibles += amount;
        monthlyMap[month].otherDeductibles += amount;
        // Also subtract from total net for tax calculation
        totalNet -= amount;
        monthlyMap[month].net -= amount;
      }
    });

    const totalFees = totalGross - (totalNet + totalOtherDeductibles);
    const totalDeductibles = totalFees + totalOtherDeductibles;
    const estTax = Math.max(0, totalNet) * taxProvisionRate;

    const monthlyBreakdown = MONTHS.map((month, index) => ({
      id: index,
      month,
      gross: monthlyMap[index].gross,
      net: monthlyMap[index].net,
      fees: monthlyMap[index].fees,
      otherDeductibles: monthlyMap[index].otherDeductibles,
    }));

    return {
      totals: {
        gross: totalGross,
        net: totalNet,
        fees: totalFees,
        otherDeductibles: totalOtherDeductibles,
        totalDeductibles: totalDeductibles,
        tax: estTax,
        expenseHold,
      },
      monthlyBreakdown,
    };
  }, [
    contractsQuery.data,
    settingsQuery.data,
    deductibleExpensesQuery.data,
    selectedYear,
  ]);

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}>
        <CircularProgress size={60} thickness={4} />
      </Box>
    );
  }

  const years = [currentYear];

  const columns: GridColDef[] = [
    { field: "month", headerName: "Month", flex: 1, sortable: false },
    {
      field: "gross",
      headerName: "Gross Earnings",
      flex: 1,
      sortable: false,
      renderCell: (params) => `$${params.value.toFixed(2)}`,
    },
    {
      field: "net",
      headerName: "Net Income",
      flex: 1,
      sortable: false,
      renderCell: (params) => `$${params.value.toFixed(2)}`,
    },
    {
      field: "fees",
      headerName: "UpWork Fees",
      flex: 1,
      sortable: false,
      renderCell: (params) => `$${params.value.toFixed(2)}`,
    },
    {
      field: "otherDeductibles",
      headerName: "Other Deductibles",
      flex: 1,
      sortable: false,
      renderCell: (params) => `$${params.value.toFixed(2)}`,
    },
  ];

  return (
    <Box sx={{ p: 4, display: "flex", flexDirection: "column", gap: 4 }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography variant="h4" sx={{ fontWeight: 900 }}>
          Taxes
        </Typography>
        <FormControl variant="outlined" size="small" sx={{ minWidth: 120 }}>
          <Select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            sx={{
              bgcolor: "background.paper",
              borderRadius: 1,
              fontWeight: 700,
              "& .MuiSelect-select": { py: 1 },
            }}
          >
            {years.map((y) => (
              <MenuItem key={y} value={y}>
                {y} Fiscal Year
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <DashboardCard
            name="Gross Earnings"
            amount={data.totals.gross}
            color={COLORS.gross}
            subtitle={`Total revenue for ${selectedYear}`}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <DashboardCard
            name="Deductible Expenses"
            amount={data.totals.totalDeductibles}
            color="#f43f5e"
            subtitle={`Fees ($${data.totals.fees.toFixed(2)}) + Other ($${data.totals.otherDeductibles.toFixed(2)})`}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <DashboardCard
            name="Taxable Net Income"
            amount={data.totals.net}
            color={COLORS.net}
            subtitle="True earnings after all deductibles"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <DashboardCard
            name="Est. Tax Savings"
            amount={data.totals.tax}
            color={COLORS.tax}
            subtitle="Amount to set aside for IRS"
          />
        </Grid>
      </Grid>

      <Paper
        sx={{
          p: 3,
          borderRadius: 2,
          border: "1px solid rgba(255,255,255,0.05)",
          bgcolor: "background.paper",
        }}
      >
        <Typography variant="h6" sx={{ mb: 3, fontWeight: 800 }}>
          Monthly Breakdown
        </Typography>
        <Box sx={{ height: 620, width: "100%" }}>
          <DataGrid
            rows={data.monthlyBreakdown}
            columns={columns}
            disableRowSelectionOnClick
            hideFooter
            rowHeight={42}
            sx={{
              border: "none",
              "& .MuiDataGrid-columnHeaders": {
                bgcolor: "rgba(255,255,255,0.02)",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                minHeight: "48px !important",
              },
              "& .MuiDataGrid-cell": {
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                fontSize: "0.85rem",
              },
              "& .MuiDataGrid-columnHeaderTitle": {
                fontWeight: 800,
                textTransform: "uppercase",
                fontSize: "0.7rem",
                letterSpacing: "1px",
                color: "text.secondary",
              },
            }}
          />
        </Box>
      </Paper>
    </Box>
  );
};
