"use client";

/**
 * BillList — DataGrid table of recurring Bills (Settings > Bills).
 *
 * Delegates chrome (toolbar, edit/create modals, delete confirm) to ResourceList.
 * Renders Name / Amount / Due Day columns with a small ordinal-suffix helper
 * ("5th", "1st") for human-friendly due day formatting. Sorted by dueDate asc.
 *
 * A bill with a TEMPORARY amount this month or later (set in its edit dialog)
 * shows it in amber under the regular amount — "$50.00 · Dec 2026 – Feb 2027"
 * — so the list says at a glance which bills are not at their usual cost.
 */

import { useMemo } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { Box, Typography } from "@mui/material";
import { useList } from "@refinedev/core";
import { BillCreate } from "./create";
import { BillEdit } from "./edit";
import { ResourceList } from "../shared/ResourceList";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { getOrdinal } from "../../lib/date-utils";
import { billMonthKey } from "../../lib/pay-period-utils";
import { formatBillOverrideRange, groupBillOverrideRanges } from "../../lib/bill-overrides";
import { TOOLTIP_AMBER } from "../../lib/tooltip-styles";

export const BillList = () => {
  // Temporary amounts for every bill (a handful of rows); the same cached
  // list the edit dialog, the Overview and the Plan read.
  const { query: overridesQuery } = useList({
    resource: "BillOverride",
    pagination: { mode: "off" },
    successNotification: false,
    errorNotification: false,
  });
  const overrides = overridesQuery.data?.data as any[] | undefined;

  const columns = useMemo<GridColDef[]>(
    () => {
      const now = new Date();
      const thisMonth = billMonthKey(now.getFullYear(), now.getMonth());
      return [
        {
          field: "name",
          headerName: "Bill Name",
          flex: 1.5,
          minWidth: 200,
          renderCell: (params) => (
            <Typography
              sx={{ fontWeight: 600, color: "white", fontSize: "1rem" }}
            >
              {params.value}
            </Typography>
          ),
        },
        {
          field: "amount",
          headerName: "Amount",
          type: "number",
          // Wide enough for the temporary-amount line under the amount.
          width: 230,
          renderCell: (params) => {
            // This month's and later temporary amounts, as readable runs.
            const ranges = groupBillOverrideRanges(overrides, String(params.row.id), thisMonth);
            const regular = (
              <Typography
                sx={{ fontWeight: 700, color: "primary.light", fontSize: "1rem" }}
              >
                ${Number(params.value).toFixed(2)}
              </Typography>
            );
            if (ranges.length === 0) return regular;
            return (
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "flex-end",
                  height: "100%",
                  lineHeight: 1.2,
                }}
              >
                {regular}
                <Typography sx={{ color: TOOLTIP_AMBER, fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap" }}>
                  ${ranges[0].amount.toFixed(2)} · {formatBillOverrideRange(ranges[0])}
                  {ranges.length > 1 ? ` +${ranges.length - 1} more` : ""}
                </Typography>
              </Box>
            );
          },
        },
        {
          field: "dueDate",
          headerName: "Due Day",
          type: "number",
          width: 120,
          renderCell: (params) => (
            <Typography sx={{ color: "text.secondary", fontSize: "1rem" }}>
              {params.value}
              {getOrdinal(params.value)}
            </Typography>
          ),
        },
      ];
    },
    [overrides],
  );

  return (
    <ResourceList
      resource="Bill"
      title="Bills"
      columns={columns}
      createModal={BillCreate}
      editModal={BillEdit}
      emptyState={{
        icon: <ReceiptLongIcon />,
        accent: "#f43f5e",
        title: "No bills yet",
        description: "Add the bills you pay every month, like rent, utilities, phone and insurance. Finances OS uses each due date to work out which paycheck should cover it, so nothing sneaks up on you.",
      }}
      initialSorters={[{ field: "dueDate", order: "asc" }]}
    />
  );
};
