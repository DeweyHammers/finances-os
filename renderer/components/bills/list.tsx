"use client";

import { useMemo } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { Typography } from "@mui/material";
import { BillCreate } from "./create";
import { BillEdit } from "./edit";
import { ResourceList } from "../shared/ResourceList";
export const BillList = () => {
  const getOrdinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  };

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
