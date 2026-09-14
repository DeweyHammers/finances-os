"use client";

/**
 * BillList — DataGrid table of recurring Bills (Settings > Bills).
 *
 * Delegates chrome (toolbar, edit/create modals, delete confirm) to ResourceList.
 * Renders Name / Amount / Due Day columns with a small ordinal-suffix helper
 * ("5th", "1st") for human-friendly due day formatting. Sorted by dueDate asc.
 */

import { useMemo } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { Typography } from "@mui/material";
import { BillCreate } from "./create";
import { BillEdit } from "./edit";
import { ResourceList } from "../shared/ResourceList";
import { getOrdinal } from "../../lib/date-utils";

export const BillList = () => {
  const columns = useMemo<GridColDef[]>(
    () => [
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
        width: 150,
        renderCell: (params) => (
          <Typography
            sx={{ fontWeight: 700, color: "primary.light", fontSize: "1rem" }}
          >
            ${Number(params.value).toFixed(2)}
          </Typography>
        ),
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
    ],
    [],
  );

  return (
    <ResourceList
      resource="Bill"
      title="Bills"
      columns={columns}
      createModal={BillCreate}
      editModal={BillEdit}
      initialSorters={[{ field: "dueDate", order: "asc" }]}
    />
  );
};
