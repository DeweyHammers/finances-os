"use client";

import { useState, useEffect } from "react";
import {
  Popover,
  Box,
  Tabs,
  Tab,
  TextField,
  Autocomplete,
  Button,
  Typography,
  ListSubheader,
} from "@mui/material";
import BoltIcon from "@mui/icons-material/Bolt";
import { toCents, formatMoney } from "../../lib/cents";
import { getCycleColor } from "../../lib/cycle-utils";

export interface AssignTargetOption {
  itemId: string;
  itemName: string;
  availableCents: number;
  groupId: string;
  groupName: string;
}

interface AssignMoneyPopoverProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  options: AssignTargetOption[];
  onClose: () => void;
  onManualAssign: (params: { itemId: string; amountCents: number }) => void;
  onAutoAssign: (cycle: string) => void;
}

const CYCLES = ["Q1", "Q2", "Q3", "Q4"];

const availableColor = (cents: number): string => {
  if (cents < 0) return "#f43f5e";
  if (cents > 0) return "#3DBC83";
  return "rgba(255,255,255,0.45)";
};

export const AssignMoneyPopover = ({
  open,
  anchorEl,
  options,
  onClose,
  onManualAssign,
  onAutoAssign,
}: AssignMoneyPopoverProps) => {
  const [tab, setTab] = useState<"manually" | "auto">("manually");
  const [destOption, setDestOption] = useState<AssignTargetOption | null>(null);
  const [amount, setAmount] = useState<string>("");

  useEffect(() => {
    if (open) {
      setTab("manually");
      setAmount("");
      setDestOption(null);
    }
  }, [open]);

  const handleManualAssign = () => {
    if (!destOption) return;
    const cents = toCents(amount);
    if (!Number.isFinite(cents) || cents <= 0) return;
    onManualAssign({ itemId: destOption.itemId, amountCents: cents });
  };

  const handleAutoAssign = (cycle: string) => {
    onAutoAssign(cycle);
    onClose();
  };

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      transformOrigin={{ vertical: "top", horizontal: "center" }}
      slotProps={{
        paper: {
          sx: {
            width: 360,
            bgcolor: "background.paper",
            backgroundImage: "none",
            borderRadius: 2,
            border: "1px solid rgba(255,255,255,0.08)",
            mt: 1,
          },
        },
      }}
    >
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="fullWidth"
        slotProps={{ indicator: { sx: { transition: "none" } } }}
        sx={{
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          "& .MuiTab-root": {
            textTransform: "none",
            fontWeight: 700,
            fontSize: "0.95rem",
            color: "rgba(255,255,255,0.5)",
          },
          "& .Mui-selected": { color: "primary.light" },
        }}
      >
        <Tab
          value="auto"
          icon={<BoltIcon sx={{ fontSize: 18 }} />}
          iconPosition="start"
          label="Auto"
        />
        <Tab value="manually" label="Manually" />
      </Tabs>

      {tab === "manually" ? (
        <Box sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 2 }}>
          <TextField
            label="Assign"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            fullWidth
            variant="outlined"
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Autocomplete
            options={options}
            value={destOption}
            onChange={(_, v) => setDestOption(v)}
            getOptionLabel={(o) => o.itemName}
            isOptionEqualToValue={(a, b) => a.itemId === b.itemId}
            groupBy={(o) => o.groupName}
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
                placeholder="Select category"
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
                    {option.itemName}
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
              onClick={handleManualAssign}
              disabled={!destOption || !amount || toCents(amount) <= 0}
              sx={{ fontWeight: 800, borderRadius: 2 }}
            >
              Assign
            </Button>
          </Box>
        </Box>
      ) : (
        <Box sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 800,
              color: "text.secondary",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Auto-Assign by Cycle
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
            {CYCLES.map((c) => {
              const color = getCycleColor(c);
              return (
                <Button
                  key={c}
                  variant="outlined"
                  onClick={() => handleAutoAssign(c)}
                  sx={{
                    fontWeight: 800,
                    color,
                    borderColor: `${color}50`,
                    bgcolor: `${color}10`,
                    py: 1,
                    "&:hover": {
                      bgcolor: `${color}25`,
                      borderColor: color,
                    },
                  }}
                >
                  {c}
                </Button>
              );
            })}
          </Box>
        </Box>
      )}
    </Popover>
  );
};
