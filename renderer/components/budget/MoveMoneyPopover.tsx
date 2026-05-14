"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Popover,
  Box,
  TextField,
  Autocomplete,
  Button,
  Typography,
  ListSubheader,
} from "@mui/material";
import { fromCents, toCents, formatMoney } from "../../lib/cents";

export interface MoveMoneyOption {
  itemId: string;
  itemName: string;
  availableCents: number;
  groupId: string;
  groupName: string;
}

interface DestOption {
  kind: "ready" | "category";
  value: string;
  label: string;
  availableCents: number;
  groupKey: string;
}

const READY_TO_ASSIGN_VALUE = "__ready__";

const READY_OPTION: DestOption = {
  kind: "ready",
  value: READY_TO_ASSIGN_VALUE,
  label: "Ready to Assign",
  availableCents: 0,
  groupKey: "Inflow",
};

interface MoveMoneyPopoverProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  sourceItemId: string;
  sourceName: string;
  sourceAvailableCents: number;
  options: MoveMoneyOption[];
  onClose: () => void;
  /**
   * destItemId is null when moving back to Ready to Assign.
   */
  onMove: (params: {
    sourceItemId: string;
    destItemId: string | null;
    amountCents: number;
  }) => void;
}

const availableColor = (cents: number): string => {
  if (cents < 0) return "#f43f5e";
  if (cents > 0) return "#3DBC83";
  return "rgba(255,255,255,0.45)";
};

export const MoveMoneyPopover = ({
  open,
  anchorEl,
  sourceItemId,
  sourceAvailableCents,
  options,
  onClose,
  onMove,
}: MoveMoneyPopoverProps) => {
  const destinations = useMemo(
    () => options.filter((o) => o.itemId !== sourceItemId),
    [options, sourceItemId],
  );
  const [destOption, setDestOption] = useState<DestOption | null>(null);
  const [amount, setAmount] = useState<string>("");

  const autocompleteOptions = useMemo<DestOption[]>(() => {
    const out: DestOption[] = [READY_OPTION];
    destinations.forEach((d) => {
      out.push({
        kind: "category",
        value: d.itemId,
        label: d.itemName,
        availableCents: d.availableCents,
        groupKey: d.groupName,
      });
    });
    return out;
  }, [destinations]);

  useEffect(() => {
    if (open) {
      const defaultAmount =
        sourceAvailableCents > 0 ? fromCents(sourceAvailableCents) : 0;
      setAmount(defaultAmount > 0 ? defaultAmount.toFixed(2) : "");
      setDestOption(null);
    }
  }, [open, sourceAvailableCents]);

  const handleMove = () => {
    if (!destOption) return;
    const cents = toCents(amount);
    if (!Number.isFinite(cents) || cents <= 0) return;
    const destItemId =
      destOption.value === READY_TO_ASSIGN_VALUE ? null : destOption.value;
    if (destItemId === sourceItemId) return;
    onMove({ sourceItemId, destItemId, amountCents: cents });
  };

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{
        paper: {
          sx: {
            p: 2.5,
            width: 340,
            bgcolor: "background.paper",
            backgroundImage: "none",
            borderRadius: 2,
            border: "1px solid rgba(255,255,255,0.08)",
          },
        },
      }}
    >
      <Typography
        variant="subtitle2"
        sx={{
          fontWeight: 800,
          mb: 2,
          color: "white",
          fontSize: "1rem",
        }}
      >
        Move
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <TextField
          label="Move"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          fullWidth
          variant="outlined"
          size="small"
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Autocomplete
          options={autocompleteOptions}
          value={destOption}
          onChange={(_, v) => setDestOption(v)}
          getOptionLabel={(o) => o.label}
          isOptionEqualToValue={(a, b) => a.value === b.value}
          groupBy={(o) => o.groupKey}
          disableClearable={false}
          openOnFocus
          slotProps={{
            popper: {
              modifiers: [
                {
                  name: "flip",
                  enabled: true,
                  options: { fallbackPlacements: ["top"] },
                },
              ],
            },
            paper: {
              sx: {
                bgcolor: "#1e293b",
                backgroundImage: "none",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 2,
              },
            },
            listbox: { sx: { maxHeight: 320, py: 0 } },
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="To"
              placeholder="Select destination"
              variant="outlined"
              size="small"
              slotProps={{
                ...(params as any).slotProps,
                inputLabel: { shrink: true },
              }}
            />
          )}
          renderGroup={(params) => (
            <li key={params.key}>
              <ListSubheader
                component="div"
                sx={{
                  bgcolor: "#1e293b",
                  color: "rgba(255,255,255,0.45)",
                  fontWeight: 700,
                  fontSize: "0.75rem",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  lineHeight: 1.5,
                  pt: 1.25,
                  pb: 0.25,
                  px: 2,
                }}
              >
                {params.group}
              </ListSubheader>
              <Box component="ul" sx={{ p: 0, m: 0 }}>
                {params.children}
              </Box>
            </li>
          )}
          renderOption={(props, option) => {
            const { key, ...rest } = props as any;
            if (option.kind === "ready") {
              return (
                <Box
                  component="li"
                  key={key}
                  {...rest}
                  sx={{
                    py: 1,
                    px: 2,
                    "&:hover": { bgcolor: "rgba(251, 191, 36, 0.08)" },
                  }}
                >
                  <Typography
                    sx={{
                      fontStyle: "italic",
                      color: "#fbbf24",
                      fontWeight: 700,
                    }}
                  >
                    {option.label}
                  </Typography>
                </Box>
              );
            }
            return (
              <Box
                component="li"
                key={key}
                {...rest}
                sx={{
                  py: 0.85,
                  px: 2,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 2,
                  alignItems: "center",
                  "&:hover": { bgcolor: "rgba(129, 140, 248, 0.08)" },
                }}
              >
                <Typography
                  sx={{
                    color: "white",
                    fontWeight: 500,
                    fontSize: "0.9rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {option.label}
                </Typography>
                <Typography
                  sx={{
                    color: availableColor(option.availableCents),
                    fontWeight: 700,
                    fontSize: "0.85rem",
                    fontVariantNumeric: "tabular-nums",
                    flexShrink: 0,
                  }}
                >
                  {formatMoney(option.availableCents)}
                </Typography>
              </Box>
            );
          }}
        />
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <Button onClick={onClose} sx={{ fontWeight: 700 }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disableElevation
            onClick={handleMove}
            disabled={!destOption || !amount || toCents(amount) <= 0}
            sx={{ fontWeight: 800, borderRadius: 2 }}
          >
            Move
          </Button>
        </Box>
      </Box>
    </Popover>
  );
};
