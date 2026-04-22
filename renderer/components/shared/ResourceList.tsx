"use client";

import { useState, useMemo, FC, ChangeEvent } from "react";
import { useDataGrid } from "@refinedev/mui";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import {
  useModalForm,
  UseModalFormReturnType,
} from "@refinedev/react-hook-form";
import { BaseRecord, HttpError, useDelete, CrudFilters } from "@refinedev/core";
import {
  Box,
  Button,
  Typography,
  IconButton,
  Paper,
  InputAdornment,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import { FieldValues } from "react-hook-form";

interface ResourceListProps {
  resource: string;
  title: string;
  columns: GridColDef[];
  createModal: FC<{
    modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
  }>;
  editModal: FC<{
    modalProps: UseModalFormReturnType<BaseRecord, HttpError, FieldValues>;
  }>;
  initialFilters?: CrudFilters;
  renderExtraFilters?: (
    setFilters: (filters: CrudFilters, behavior?: "merge" | "replace") => void,
    currentFilters: CrudFilters,
  ) => React.ReactNode;
  height?: string;
}

export const ResourceList: FC<ResourceListProps> = ({
  resource,
  title,
  columns: userColumns,
  createModal: CreateModal,
  editModal: EditModal,
  initialFilters,
  renderExtraFilters,
  height = "calc(100vh - 120px)",
}) => {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { mutate: deleteMutate } = useDelete();

  const {
    dataGridProps,
    setFilters,
    filters: currentFilters,
  } = useDataGrid({
    resource: resource,
    syncWithLocation: true,
    sorters: {
      initial: [{ field: "date", order: "desc" }],
    },
    filters: {
      initial: initialFilters,
    },
  });

  const createModalProps = useModalForm<BaseRecord, HttpError, FieldValues>({
    refineCoreProps: {
      resource: resource,
      action: "create",
    },
    syncWithLocation: true,
    defaultValues: {
      date: new Date().toISOString().split("T")[0],
    },
  });

  const editModalProps = useModalForm<BaseRecord, HttpError, FieldValues>({
    refineCoreProps: {
      resource: resource,
      action: "edit",
    },
    syncWithLocation: true,
  });

  const {
    modal: { show: showCreate },
  } = createModalProps;
  const {
    modal: { show: showEdit },
  } = editModalProps;

  const handleDelete = () => {
    if (deleteId) {
      deleteMutate({
        resource: resource,
        id: deleteId,
      });
      setDeleteId(null);
    }
  };

  const columns = useMemo<GridColDef[]>(
    () => [
      ...userColumns,
      {
        field: "actions",
        headerName: "Actions",
        sortable: false,
        headerAlign: "right",
        align: "right",
        width: 100,
        renderCell: (params) => (
          <Box
            sx={{
              display: "flex",
              gap: 0.5,
              justifyContent: "flex-end",
              alignItems: "center",
              height: "100%",
            }}
          >
            <IconButton
              size="small"
              onClick={() => showEdit(params.row.id)}
              sx={{
                width: 28,
                height: 28,
                color: "primary.light",
                bgcolor: "rgba(129, 140, 248, 0.05)",
                "&:hover": { bgcolor: "rgba(129, 140, 248, 0.15)" },
              }}
            >
              <EditIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => setDeleteId(params.row.id)}
              sx={{
                width: 28,
                height: 28,
                color: "error.light",
                bgcolor: "rgba(248, 113, 113, 0.05)",
                "&:hover": { bgcolor: "rgba(248, 113, 113, 0.15)" },
              }}
            >
              <DeleteIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        ),
      },
    ],
    [userColumns, showEdit],
  );

  const handleSearch = (e: ChangeEvent<HTMLInputElement>) => {
    setFilters(
      [
        {
          field: "name",
          operator: "contains",
          value: e.target.value || undefined,
        },
      ],
      "merge",
    );
  };

  return (
    <Box
      sx={{
        height: height,
        p: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          width: "100%",
          maxWidth: 1600,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          p: 3,
          bgcolor: "#1e293b",
          borderRadius: 2,
          border: "1px solid rgba(129, 140, 248, 0.2)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Typography variant="h4" sx={{ fontWeight: 900, color: "white" }}>
            {title}
          </Typography>
          <Button
            variant="contained"
            disableElevation
            startIcon={<AddIcon />}
            onClick={() => showCreate()}
            sx={{
              px: 4,
              py: 1,
              borderRadius: 2,
              fontWeight: 800,
              bgcolor: "primary.main",
              boxShadow: "0 4px 12px 0 rgba(129, 140, 248, 0.3)",
              "&:hover": {
                bgcolor: "primary.dark",
                boxShadow: "0 6px 16px 0 rgba(129, 140, 248, 0.4)",
                transform: "translateY(-1px)",
              },
              transition: "all 0.2s",
            }}
          >
            Create New {title.replace(/s$/, "")}
          </Button>
        </Box>

        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            alignItems: "flex-start",
          }}
        >
          <Box sx={{ position: "relative" }}>
            <TextField
              size="small"
              placeholder="Search by name..."
              onChange={handleSearch}
              sx={{
                width: 400,
                "& .MuiOutlinedInput-root": {
                  borderRadius: 2,
                  bgcolor: "rgba(255,255,255,0.03)",
                  height: 44,
                },
              }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon
                        fontSize="small"
                        sx={{ color: "text.secondary" }}
                      />
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Box>
          {renderExtraFilters && renderExtraFilters(setFilters, currentFilters)}
        </Box>

        <Paper
          sx={{
            bgcolor: "rgba(15, 23, 42, 0.5)",
            borderRadius: 2,
            overflow: "hidden",
            border: "1px solid rgba(255, 255, 255, 0.05)",
            flexGrow: 1,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <DataGrid
            {...(dataGridProps as any)}
            columns={columns}
            rowHeight={64}
            disableRowSelectionOnClick
            disableColumnMenu
            disableColumnFilter
            autoHeight={false}
            sx={{
              border: "none",
              "& .MuiDataGrid-columnSeparator": {
                display: "none",
              },
              "& .MuiDataGrid-menuIcon": {
                display: "none",
              },
              "& .MuiDataGrid-filterIcon": {
                display: "none",
              },
              "& .MuiDataGrid-main": {
                overflow: "auto",
              },
              "& .MuiDataGrid-virtualScroller": {
                overflowY: "auto !important",
                overflowX: "auto !important",
              },
              "& .MuiDataGrid-columnHeaders": {
                bgcolor: "rgba(255, 255, 255, 0.02)",
                borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
                fontSize: "0.9rem",
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "1px",
                minHeight: "56px !important",
                maxHeight: "56px !important",
              },
              "& .MuiDataGrid-cell": {
                borderBottom: "1px solid rgba(255, 255, 255, 0.02)",
                display: "flex",
                alignItems: "center",
              },
              "& .MuiDataGrid-footerContainer": {
                borderTop: "1px solid rgba(255, 255, 255, 0.05)",
                minHeight: "56px !important",
                maxHeight: "56px !important",
              },
            }}
          />
        </Paper>
      </Box>

      <CreateModal modalProps={createModalProps} />
      <EditModal modalProps={editModalProps} />

      <Dialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: 2,
              bgcolor: "background.paper",
              backgroundImage: "none",
              p: 1,
            },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: "1.2rem", pb: 1 }}>
          Delete {title.replace(/s$/, "")}?
        </DialogTitle>
        <DialogContent sx={{ pb: 1 }}>
          <DialogContentText
            sx={{ color: "text.secondary", fontSize: "0.9rem" }}
          >
            Are you sure? This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button
            onClick={() => setDeleteId(null)}
            size="small"
            sx={{
              fontWeight: 700,
              color: "text.secondary",
              textTransform: "none",
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            variant="contained"
            color="error"
            size="small"
            disableElevation
            sx={{
              px: 2,
              borderRadius: 1.5,
              fontWeight: 700,
              textTransform: "none",
              bgcolor: "error.main",
              "&:hover": { bgcolor: "error.dark" },
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
