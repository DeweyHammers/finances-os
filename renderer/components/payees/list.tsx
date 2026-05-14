"use client";

import { useMemo } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { Typography } from "@mui/material";
import { ResourceList } from "../shared/ResourceList";
import { PayeeCreate } from "./create";
import { PayeeEdit } from "./edit";

export const PayeesList = () => {
  const columns = useMemo<GridColDef[]>(
    () => [
      {
        field: "name",
        headerName: "Payee Name",
        flex: 1,
        minWidth: 250,
        renderCell: (params) => (
          <Typography
            sx={{ fontWeight: 600, color: "white", fontSize: "1rem" }}
          >
            {params.value}
          </Typography>
        ),
      },
    ],
    [],
  );

  return (
    <ResourceList
      resource="Payee"
      title="Payees"
      columns={columns}
      createModal={PayeeCreate}
      editModal={PayeeEdit}
      initialSorters={[{ field: "name", order: "asc" }]}
    />
  );
};
