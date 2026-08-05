"use client";

import { useMemo } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { Box, Typography } from "@mui/material";
import { PersonalCreate } from "./create";
import { PersonalEdit } from "./edit";
import { ResourceList } from "../shared/ResourceList";

export const PersonalList = () => {
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
        field: "repeatWeekly",
        headerName: "Schedule",
        width: 180,
        headerAlign: "center",
        renderCell: (params) => {
          const isWeekly = !!params.value;
          const isSplit = !!params.row.splitAcrossWeeks;
          const dueDate = params.row.dueDate;
          const weekOfMonth = params.row.weekOfMonth;
          const chipSx = {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            bgcolor: "rgba(129,140,248,0.15)",
            color: "#818cf8",
            fontSize: "0.8rem",
            fontWeight: 900,
            borderLeft: "3px solid rgba(129,140,248,0.5)",
          };
          if (isSplit) return <Box sx={chipSx}>Split Monthly</Box>;
          if (isWeekly) return <Box sx={chipSx}>Every Week</Box>;
          if (weekOfMonth != null) return <Box sx={chipSx}>Week {weekOfMonth}</Box>;
          return (
            <Typography sx={{ color: "text.secondary", fontSize: "0.9rem" }}>
              Due {dueDate}{getOrdinal(Number(dueDate))}
            </Typography>
          );
        },
      },
    ],
    [],
  );

  return (
    <ResourceList
      resource="Personal"
      title="Personal"
      columns={columns}
      createModal={PersonalCreate}
      editModal={PersonalEdit}
      gridSx={{
        "& .MuiDataGrid-cell[data-field='repeatWeekly']": {
          padding: 0,
        },
      }}
    />
  );
};
