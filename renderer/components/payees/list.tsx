"use client";

/**
 * PayeesList — DataGrid table of Payee records (Settings > Payees).
 *
 * Payees back the transaction PayeeAutocomplete lookup. This is intentionally
 * minimal — payees are just names; there's no amount, schedule, or metadata.
 * Sorted alphabetically by name.
 */

import { useMemo } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { Typography } from "@mui/material";
import { ResourceList } from "../shared/ResourceList";
import StorefrontIcon from "@mui/icons-material/Storefront";
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
      emptyState={{
        icon: <StorefrontIcon />,
        accent: "#38bdf8",
        title: "No payees yet",
        description: "Payees are the people and businesses you pay (or who pay you). They are created automatically as you record transactions, and consistent names keep your Statistics tidy.",
      }}
      initialSorters={[{ field: "name", order: "asc" }]}
    />
  );
};
