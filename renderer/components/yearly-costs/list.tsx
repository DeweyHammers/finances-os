"use client";

import { useMemo } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { Typography } from "@mui/material";
import { YearlyCostCreate } from "./create";
import { YearlyCostEdit } from "./edit";
import { ResourceList } from "../shared/ResourceList";
import { SHORT_MONTHS } from "../../lib/constants";

export const YearlyCostList = () => {
  const columns = useMemo<GridColDef[]>(
    () => [
      {
        field: "name",
        headerName: "Cost Name",
        flex: 1.5,
        minWidth: 200,
        renderCell: (params) => (
          <Typography
            sx={{ fontWeight: 600, color: "white", fontSize: "1rem" }}
          >
            {params.value?.toString().trim()}
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
        field: "month",
        headerName: "Date",
        width: 150,
        valueGetter: (value, row) => {
          if (!row.month || !row.day) return "-";
          return `${SHORT_MONTHS[row.month - 1]} ${row.day}`;
        },
        renderCell: (params) => (
          <Typography sx={{ color: "text.secondary", fontSize: "1rem" }}>
            {params.value}
          </Typography>
        ),
      },
    ],
    [],
  );

  return (
    <ResourceList
      resource="YearlyCost"
      title="Yearly Costs"
      columns={columns}
      createModal={YearlyCostCreate}
      editModal={YearlyCostEdit}
    />
  );
};
