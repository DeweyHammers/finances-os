"use client";

import { FC, useMemo } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { Typography, Chip } from "@mui/material";
import { ClientCreate } from "./create";
import { ClientEdit } from "./edit";
import { ResourceList } from "../shared/ResourceList";

export const ClientList: FC = () => {
  const columns = useMemo<GridColDef[]>(
    () => [
      {
        field: "name",
        headerName: "Client Name",
        flex: 1,
        renderCell: (params) => (
          <Typography sx={{ fontWeight: 600, color: "white" }}>
            {params.value}
          </Typography>
        ),
      },
      {
        field: "activeContracts",
        headerName: "Active",
        width: 100,
        sortable: false,
        renderCell: (params) => {
          const activeCount =
            params.row.contracts?.filter((c: any) => c.status === "ACTIVE")
              .length || 0;
          return (
            <Chip
              label={activeCount}
              size="small"
              sx={{
                fontWeight: 900,
                bgcolor:
                  activeCount > 0 ? "success.main" : "rgba(255,255,255,0.05)",
                color: activeCount > 0 ? "#0f172a" : "text.disabled",
                minWidth: 24,
                height: 24,
                borderRadius: "12px",
                "& .MuiChip-label": { px: 0 },
              }}
            />
          );
        },
      },
      {
        field: "completedContracts",
        headerName: "Completed",
        width: 120,
        sortable: false,
        renderCell: (params) => {
          const completedCount =
            params.row.contracts?.filter((c: any) => c.status === "COMPLETED")
              .length || 0;
          return (
            <Chip
              label={completedCount}
              size="small"
              sx={{
                fontWeight: 900,
                bgcolor:
                  completedCount > 0
                    ? "primary.main"
                    : "rgba(255,255,255,0.05)",
                color: completedCount > 0 ? "#0f172a" : "text.disabled",
                minWidth: 24,
                height: 24,
                borderRadius: "12px",
                "& .MuiChip-label": { px: 0 },
              }}
            />
          );
        },
      },
    ],
    [],
  );

  return (
    <ResourceList
      resource="Client"
      title="Clients"
      columns={columns}
      createModal={ClientCreate}
      editModal={ClientEdit}
    />
  );
};
