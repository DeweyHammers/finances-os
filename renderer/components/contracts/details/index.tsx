"use client";

import { FC, useState, useMemo } from "react";
import {
  Box,
  Typography,
  Grid,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Chip,
} from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useParams, useRouter } from "next/navigation";
import {
  useShow,
  useCreate,
  useDelete,
  useUpdate,
  useOne,
} from "@refinedev/core";
import { useForm } from "react-hook-form";
import { startOfDay, addDays } from "date-fns";

import { SummaryCards } from "./SummaryCards";
import { EntryTable } from "./EntryTable";
import { EntryForm } from "./EntryForm";

export const ContractDetailsView: FC = () => {
  const { id } = useParams();
  const router = useRouter();
  const [editingEntry, setEditingEntry] = useState<any>(null);

  const { query: contractQuery } = useShow({
    resource: "Contract",
    id: id as string,
  });

  const { query: settingsQuery } = useOne({
    resource: "AppSettings",
    id: "global",
  });

  const settings = settingsQuery.data?.data;
  const contract = contractQuery.data?.data;
  const entries = contract?.entries || [];

  const { mutate: createEntry } = useCreate();
  const { mutate: updateEntry } = useUpdate();
  const { mutate: updateContract } = useUpdate();
  const { mutate: deleteEntry } = useDelete();

  // Default date to the Saturday of the current week
  const defaultDate = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = 6 - day;
    return startOfDay(addDays(now, diff));
  }, []);

  const addForm = useForm({
    defaultValues: {
      date: defaultDate,
      hours: undefined,
      grossPay: undefined,
      netPay: undefined,
    },
  });

  const editForm = useForm({
    defaultValues: {
      date: null as Date | null,
      hours: undefined,
      grossPay: undefined,
      netPay: undefined,
    },
  });

  const onToggleStatus = () => {
    if (!contract) return;

    const isCompleting = contract.status === "ACTIVE";
    const now = new Date().toISOString();

    const updateData: any = {
      status: isCompleting ? "COMPLETED" : "ACTIVE",
      completedDate: isCompleting ? now : null,
    };

    if (contract.type === "HOURLY") {
      updateData.endDate = isCompleting ? now : null;
    }

    updateContract(
      {
        resource: "Contract",
        id: contract.id,
        values: updateData,
      },
      {
        onSuccess: () => {
          contractQuery.refetch();
        },
      },
    );
  };

  const onAddEntry = (data: any) => {
    createEntry(
      {
        resource: "ContractEntry",
        values: {
          ...data,
          date: data.date instanceof Date ? data.date.toISOString() : data.date,
          contractId: id,
          grossPay: Number(data.grossPay),
          netPay: Number(data.netPay),
          hours: Number(data.hours || 0),
        },
      },
      {
        onSuccess: () => {
          addForm.setValue("hours", undefined);
          addForm.setValue("grossPay", undefined);
          addForm.setValue("netPay", undefined);
          addForm.reset({
            date: defaultDate,
            hours: undefined,
            grossPay: undefined,
            netPay: undefined,
          });
          contractQuery.refetch();
        },
      },
    );
  };

  const onUpdateEntry = (data: any) => {
    updateEntry(
      {
        resource: "ContractEntry",
        id: editingEntry.id,
        values: {
          ...data,
          date: data.date instanceof Date ? data.date.toISOString() : data.date,
          grossPay: Number(data.grossPay),
          netPay: Number(data.netPay),
          hours: Number(data.hours || 0),
        },
      },
      {
        onSuccess: () => {
          setEditingEntry(null);
          contractQuery.refetch();
        },
      },
    );
  };

  const onDeleteEntry = (entryId: string) => {
    deleteEntry(
      {
        resource: "ContractEntry",
        id: entryId,
      },
      {
        onSuccess: () => {
          contractQuery.refetch();
        },
      },
    );
  };

  const handleEditClick = (entry: any) => {
    setEditingEntry(entry);
    editForm.reset({
      date: new Date(entry.date),
      hours: entry.hours,
      grossPay: entry.grossPay,
      netPay: entry.netPay,
    });
  };

  if (contractQuery.isLoading) {
    return (
      <Typography sx={{ p: 4, color: "white" }}>
        Loading contract details...
      </Typography>
    );
  }

  if (!contract) {
    return (
      <Typography sx={{ p: 4, color: "white" }}>Contract not found.</Typography>
    );
  }

  const isActive = contract.status === "ACTIVE";

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Box
        sx={{
          p: 4,
          height: "100%",
          overflow: "auto",
          bgcolor: "background.default",
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            mb: 4,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <IconButton
              onClick={() => router.back()}
              sx={{ color: "primary.main" }}
            >
              <ArrowBackIcon />
            </IconButton>
            <Box>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  mb: 0.5,
                }}
              >
                <Typography
                  variant="h4"
                  sx={{ fontWeight: 900, color: "white" }}
                >
                  {contract.name}
                </Typography>
                <Chip
                  label={contract.status}
                  size="small"
                  color={isActive ? "success" : "default"}
                  sx={{
                    mt: 1.5,
                    fontWeight: 800,
                    fontSize: "0.7rem",
                    height: 24,
                  }}
                />
              </Box>
              <Typography variant="subtitle1" sx={{ color: "text.secondary" }}>
                {contract.client?.name} • {contract.type}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ pt: 1 }}>
            <Button
              variant="contained"
              color={isActive ? "success" : "primary"}
              startIcon={isActive ? <CheckCircleIcon /> : <PlayArrowIcon />}
              onClick={onToggleStatus}
              sx={{
                fontWeight: 800,
                px: 3,
                py: 1,
                borderRadius: 2,
                boxShadow: isActive
                  ? "0 4px 14px 0 rgba(16, 185, 129, 0.39)"
                  : "none",
              }}
            >
              {isActive ? "Complete Contract" : "Mark as Active"}
            </Button>
          </Box>
        </Box>

        <SummaryCards
          contract={contract}
          entries={entries}
          settings={settings}
        />

        <Grid container spacing={4}>
          <Grid size={{ xs: 12, lg: 8 }}>
            <EntryTable
              entries={entries}
              onEdit={handleEditClick}
              onDelete={onDeleteEntry}
              contract={contract}
            />
          </Grid>
          <Grid size={{ xs: 12, lg: 4 }}>
            <EntryForm
              formProps={addForm}
              onSubmit={onAddEntry}
              title="Add Weekly Entry"
              buttonText="Add Weekly Entry"
              contract={contract}
            />
          </Grid>
        </Grid>

        {/* Edit Entry Dialog - Styled to match ResourceEditModal */}
        <Dialog
          open={!!editingEntry}
          onClose={() => setEditingEntry(null)}
          maxWidth="xs"
          fullWidth
          slotProps={{
            paper: {
              sx: {
                borderRadius: 3,
                bgcolor: "background.paper",
                backgroundImage: "none",
              },
            },
          }}
        >
          <DialogTitle
            sx={{ fontWeight: 900, pt: 3, px: 4, fontSize: "1.5rem" }}
          >
            Edit Weekly Entry
          </DialogTitle>
          <DialogContent sx={{ px: 4, pb: 2 }}>
            <Box sx={{ mt: 2 }}>
              <EntryForm
                formProps={editForm}
                onSubmit={onUpdateEntry}
                title=""
                buttonText="Update Entry"
                contract={contract}
                noPaper
                hideButton
              />
            </Box>
          </DialogContent>
          <DialogActions sx={{ p: 4, pt: 1 }}>
            <Button
              onClick={() => setEditingEntry(null)}
              sx={{ fontWeight: 700, color: "text.secondary" }}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              disableElevation
              sx={{ px: 4, py: 1, borderRadius: 2, fontWeight: 800 }}
              onClick={editForm.handleSubmit(onUpdateEntry)}
            >
              Update Entry
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </LocalizationProvider>
  );
};
