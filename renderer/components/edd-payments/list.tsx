"use client";

import { FC, useMemo } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { Typography } from "@mui/material";
import { formatDate } from "../../lib/date-utils";
import { ResourceList } from "../shared/ResourceList";
import { EddPaymentCreate } from "./create";
import { EddPaymentEdit } from "./edit";

export const EddPaymentList: FC = () => {
  const columns = useMemo<GridColDef[]>(
    () => [
      {
        field: "date",
        headerName: "Date",
        flex: 1,
        renderCell: (params) => (
          <Typography sx={{ color: "text.secondary" }}>
            {formatDate(params.value)}
          </Typography>
        ),
      },
      {
        field: "amount",
        headerName: "Amount",
        flex: 1,
        renderCell: (params) => (
          <Typography sx={{ fontWeight: 700, color: "success.light" }}>
            ${params.value?.toFixed(2)}
          </Typography>
        ),
      },
    ],
    [],
  );

  return (
    <ResourceList
      resource="EddPayment"
      title="EDD Payments"
      columns={columns}
      createModal={EddPaymentCreate}
      editModal={EddPaymentEdit}
    />
  );
};
