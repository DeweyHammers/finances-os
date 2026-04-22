"use client";

import { useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  IconButton,
  Typography,
  FormControlLabel,
} from "@mui/material";
import { useList, BaseRecord, useDelete, HttpError } from "@refinedev/core";
import { useForm as useRefineForm } from "@refinedev/react-hook-form";
import DeleteIcon from "@mui/icons-material/Delete";
import { AppSwitch } from "../app-settings/AppSwitch";

// Sub-components
import { ColorPicker } from "./modal/ColorPicker";
import { TimeFields } from "./modal/TimeFields";
import { ContractSelector } from "./modal/ContractSelector";
import { COLORS } from "../../lib/constants";

interface EventModalProps {
  open: boolean;
  onClose: () => void;
  eventId?: string;
  initialValues?: any;
}

export interface CalendarFormValues {
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  isRecurring: boolean;
  frequency: string;
  color: string;
  contractId: string;
}

export default function EventModal({
  open,
  onClose,
  eventId,
  initialValues,
}: EventModalProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    control,
    formState: { errors },
    refineCore: { onFinish, query },
  } = useRefineForm<BaseRecord, HttpError, CalendarFormValues>({
    refineCoreProps: {
      resource: "PlannedBlock",
      action: eventId ? "edit" : "create",
      id: eventId,
      onMutationSuccess: () => onClose(),
    },
    defaultValues: {
      title: "",
      description: "",
      startTime: new Date(),
      endTime: new Date(Date.now() + 3600000),
      allDay: true,
      isRecurring: false,
      frequency: "WEEKLY",
      color: COLORS.gross,
      contractId: "",
    },
  });

  const selectedColor = watch("color") || COLORS.gross;
  const isAllDay = watch("allDay") || false;
  const isRecurring = watch("isRecurring") || false;

  const { query: contractsQuery } = useList<BaseRecord>({
    resource: "Contract",
    filters: [{ field: "status", operator: "eq", value: "ACTIVE" }],
  });

  const { mutate: deleteMutate } = useDelete();

  useEffect(() => {
    if (!open) return;

    if (eventId && query?.data?.data) {
      const data = query.data.data;
      reset({
        title: data.title || "",
        description: data.description || "",
        startTime: data.startTime,
        endTime: data.endTime,
        allDay: data.allDay || false,
        isRecurring: data.isRecurring || false,
        frequency: data.frequency || "WEEKLY",
        color: data.color || COLORS.gross,
        contractId: data.contractId || "",
      });
    } else if (!eventId && initialValues) {
      reset({
        title: initialValues.title || "",
        description: initialValues.description || "",
        startTime: initialValues.startTime,
        endTime: initialValues.endTime,
        allDay:
          initialValues.allDay !== undefined ? initialValues.allDay : true,
        isRecurring: false,
        frequency: "WEEKLY",
        color: COLORS.gross,
        contractId: initialValues.contractId || "",
      });
    } else if (!eventId) {
      reset({
        title: "",
        description: "",
        startTime: new Date(),
        endTime: new Date(Date.now() + 3600000),
        allDay: true,
        isRecurring: false,
        frequency: "WEEKLY",
        color: COLORS.gross,
        contractId: "",
      });
    }
  }, [open, eventId, query?.data?.data, initialValues, reset]);

  const handleDelete = () => {
    if (eventId) {
      deleteMutate(
        { resource: "PlannedBlock", id: eventId },
        { onSuccess: () => onClose() },
      );
    }
  };

  const renderSwitch = (
    name: any,
    label: string,
    desc: string,
    isChecked: boolean,
  ) => (
    <FormControlLabel
      labelPlacement="start"
      control={
        <AppSwitch
          checked={isChecked}
          onChange={(e) => setValue(name, e.target.checked)}
        />
      }
      label={
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2">{label}</Typography>
          <Typography variant="caption" color="text.secondary">
            {desc}
          </Typography>
        </Box>
      }
      sx={{
        display: "flex",
        justifyContent: "space-between",
        width: "100%",
        ml: 0,
        p: 2,
        borderRadius: 2,
        bgcolor: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    />
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={handleSubmit(onFinish)}>
        <DialogTitle
          component="div"
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Typography variant="h6">
            {eventId ? "Edit Event" : "Add Event"}
          </Typography>
          {eventId && (
            <IconButton color="error" onClick={handleDelete} size="small">
              <DeleteIcon />
            </IconButton>
          )}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3, mt: 2 }}>
            <TextField
              {...register("title", { required: "Title is required" })}
              label="Event Title"
              fullWidth
              error={!!errors.title}
              helperText={errors.title?.message as string}
            />
            <TextField
              {...register("description")}
              label="Details"
              fullWidth
              multiline
              rows={3}
              placeholder="Add notes..."
            />
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {renderSwitch(
                "allDay",
                "All Day",
                "Toggle for full-day events.",
                isAllDay,
              )}
              {renderSwitch(
                "isRecurring",
                "Repeat Weekly",
                "Repeat this event every week.",
                isRecurring,
              )}
            </Box>
            <TimeFields control={control} isAllDay={isAllDay} errors={errors} />
            <ColorPicker
              selectedColor={selectedColor}
              onChange={(c) => setValue("color", c)}
            />
            <input type="hidden" {...register("color")} />
            <ContractSelector
              control={control}
              contracts={contractsQuery.data?.data || []}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" color="primary">
            {eventId ? "Save Changes" : "Create Event"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
