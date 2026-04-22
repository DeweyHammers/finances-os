"use client";

import { FC, useMemo } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { Typography } from "@mui/material";
import { formatDate } from "../../lib/date-utils";
import { ResourceList } from "../shared/ResourceList";
import { JobReportCreate } from "./create";
import { JobReportEdit } from "./edit";

export const JobReportList: FC = () => {
  const columns = useMemo<GridColDef[]>(
    () => [
      {
        field: "employerName",
        headerName: "Employer",
        flex: 1,
        renderCell: (params) => (
          <Typography sx={{ fontWeight: 600 }}>{params.value}</Typography>
        ),
      },
      {
        field: "date",
        headerName: "Report Date",
        flex: 1,
        renderCell: (params) => (
          <Typography sx={{ color: "text.secondary" }}>
            {formatDate(params.value)}
          </Typography>
        ),
      },
    ],
    [],
  );

  return (
    <ResourceList
      resource="JobReported"
      title="Job Reported"
      columns={columns}
      createModal={JobReportCreate}
      editModal={JobReportEdit}
    />
  );
};
