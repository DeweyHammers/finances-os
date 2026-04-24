"use client";

import { FC, useMemo } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { Typography, Chip, Box, Button, ButtonGroup } from "@mui/material";
import { useOne } from "@refinedev/core";
import { ContractCreate } from "./create";
import { ContractEdit } from "./edit";
import { ResourceList } from "../shared/ResourceList";
import { formatDate } from "../../lib/date-utils";
import Link from "next/link";

const ClientName: FC<{ id: string }> = ({ id }) => {
  const {
    query: { data: clientData, isLoading },
  } = useOne({
    resource: "Client",
    id,
  });
  if (isLoading) return <Typography variant="caption">...</Typography>;
  return (
    <Typography color="text.secondary">
      {clientData?.data?.name || "N/A"}
    </Typography>
  );
};

export const ContractList: FC = () => {
  const columns = useMemo<GridColDef[]>(
    () => [
      {
        field: "action",
        headerName: "",
        width: 160,
        sortable: false,
        renderCell: (params: any) => (
          <Button
            component={Link}
            href={`/Contract/details?id=${params.row.id}`}
            variant="contained"
            size="small"
            sx={{
              bgcolor: "rgba(16, 185, 129, 0.1)",
              color: "success.light",
              border: "1px solid rgba(16, 185, 129, 0.2)",
              fontWeight: 800,
              fontSize: "0.7rem",
              "&:hover": {
                bgcolor: "rgba(16, 185, 129, 0.2)",
              },
            }}
          >
            Add Earnings
          </Button>
        ),
      },
      {
        field: "name",
        headerName: "Contract Name",
        flex: 2.5,
        renderCell: (params: any) => (
          <Typography sx={{ fontWeight: 600, color: "white" }}>
            {params.value}
          </Typography>
        ),
      },
      {
        field: "status",
        headerName: "Status",
        width: 140,
        filterable: false,
        sortable: false,
        renderCell: (params: any) => (
          <Chip
            label={params.value}
            size="small"
            variant="outlined"
            sx={{
              fontWeight: 700,
              borderColor:
                params.value === "ACTIVE" ? "success.main" : "text.disabled",
              color:
                params.value === "ACTIVE" ? "success.light" : "text.disabled",
            }}
          />
        ),
      },
      {
        field: "clientId",
        headerName: "Client",
        flex: 1,
        renderCell: (params: any) => <ClientName id={params.value} />,
      },
      {
        field: "type",
        headerName: "Type",
        width: 120,
        renderCell: (params: any) => (
          <Chip
            label={params.value}
            size="small"
            sx={{
              fontWeight: 700,
              bgcolor:
                params.value === "HOURLY" ? "primary.main" : "secondary.main",
            }}
          />
        ),
      },
      {
        field: "grossRate",
        headerName: "Gross Rate",
        type: "number",
        width: 130,
        renderCell: (params: any) => (
          <Typography sx={{ fontWeight: 700, color: "primary.light" }}>
            ${params.value?.toFixed(2)}
            {params.row.type === "HOURLY" ? "/hr" : ""}
          </Typography>
        ),
      },
      {
        field: "netRate",
        headerName: "Net Rate",
        type: "number",
        width: 130,
        renderCell: (params: any) => (
          <Typography sx={{ fontWeight: 700, color: "success.light" }}>
            ${params.value?.toFixed(2)}
            {params.row.type === "HOURLY" ? "/hr" : ""}
          </Typography>
        ),
      },
      {
        field: "details",
        headerName: "Contract Details",
        flex: 1.2,
        sortable: false,
        renderCell: (params: any) => {
          if (params.row.type === "HOURLY") {
            const startStr =
              formatDate(params.row.startDate, "MM/dd/yy") || "N/A";
            const endStr =
              formatDate(params.row.endDate, "MM/dd/yy") || "Present";

            return (
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  height: "100%",
                  lineHeight: 1.2,
                }}
              >
                <Typography
                  variant="body2"
                  sx={{ color: "text.primary", fontWeight: 500 }}
                >
                  {params.row.weeklyHours || 0} hrs/week
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {startStr} - {endStr}
                </Typography>
              </Box>
            );
          }
          return (
            <Typography variant="body2" color="text.secondary">
              Completed Date:{" "}
              {formatDate(params.row.completedDate, "MMM dd, yyyy") ||
                "Unknown"}
            </Typography>
          );
        },
      },
    ],
    [],
  );

  return (
    <ResourceList
      resource="Contract"
      title="Contracts"
      columns={columns}
      createModal={ContractCreate}
      editModal={ContractEdit}
      initialFilters={[
        {
          field: "status",
          operator: "eq",
          value: "ACTIVE",
        },
      ]}
      renderExtraFilters={(setFilters, currentFilters) => {
        const statusFilter = currentFilters.find(
          (f) => "field" in f && f.field === "status",
        );
        const currentStatus =
          statusFilter &&
          "value" in statusFilter &&
          statusFilter.value !== undefined
            ? statusFilter.value
            : "ALL";

        const handleStatusChange = (status: string | undefined) => {
          setFilters(
            [
              {
                field: "status",
                operator: "eq",
                value: status,
              },
            ],
            "merge",
          );
        };

        return (
          <ButtonGroup
            size="small"
            sx={{
              bgcolor: "rgba(255,255,255,0.03)",
              borderRadius: 2,
              "& .MuiButton-root": {
                px: 3,
                py: 0.75,
                borderColor: "rgba(255,255,255,0.1)",
                color: "text.secondary",
                fontWeight: 700,
                fontSize: "0.75rem",
                "&.active": {
                  bgcolor: "primary.main",
                  color: "white",
                  "&:hover": {
                    bgcolor: "primary.dark",
                  },
                },
                "&:hover": {
                  bgcolor: "rgba(255,255,255,0.08)",
                },
              },
            }}
          >
            <Button
              className={currentStatus === "ALL" ? "active" : ""}
              onClick={() => handleStatusChange(undefined)}
            >
              ALL
            </Button>
            <Button
              className={currentStatus === "ACTIVE" ? "active" : ""}
              onClick={() => handleStatusChange("ACTIVE")}
            >
              ACTIVE
            </Button>
            <Button
              className={currentStatus === "COMPLETED" ? "active" : ""}
              onClick={() => handleStatusChange("COMPLETED")}
            >
              COMPLETED
            </Button>
          </ButtonGroup>
        );
      }}
    />
  );
};
