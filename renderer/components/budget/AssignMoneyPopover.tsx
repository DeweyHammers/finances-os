"use client";

import { useState, useEffect } from "react";
import {
  Popover,
  Box,
  TextField,
  Autocomplete,
  Button,
  Typography,
  ListSubheader,
} from "@mui/material";
import BoltIcon from "@mui/icons-material/Bolt";
import { toCents, formatMoney } from "../../lib/cents";
import { CancelButton } from "../shared/CancelButton";
import { PayPeriod } from "../../lib/pay-period-utils";

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
  periods: PayPeriod[];
  onClose: () => void;
  onManualAssign: (params: { itemId: string; amountCents: number }) => void;
  onAutoAssign: (period: PayPeriod) => void;
}

const availableColor = (cents: number): string => {
  if (cents < 0) return "#f43f5e";
  if (cents > 0) return "#3DBC83";
  return "rgba(255,255,255,0.45)";
};

export const AssignMoneyPopover = ({
  open,
  anchorEl,
  options,
  periods,
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

  const handleAutoAssign = (period: PayPeriod) => {
    onAutoAssign(period);
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
      <Box sx={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {([
          { value: "auto" as const, label: "Auto", icon: <BoltIcon sx={{ fontSize: 18 }} /> },
          { value: "manually" as const, label: "Manually", icon: null },
        ] as const).map((t) => (
          <Box
            key={t.value}
            onClick={() => setTab(t.value)}
            sx={{
              flex: 1,
              py: 1.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 0.75,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: "0.95rem",
              color: tab === t.value ? "primary.light" : "rgba(255,255,255,0.5)",
              borderBottom: "2px solid",
              borderColor: tab === t.value ? "primary.light" : "transparent",
              userSelect: "none",
            }}
          >
            {t.icon}
            {t.label}
          </Box>
        ))}
      </Box>

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
            <CancelButton onClick={onClose} />
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
            Auto-Assign for Pay Week
          </Typography>
          {periods.length === 0 ? (
            <Typography sx={{ color: "text.secondary", fontSize: "0.85rem" }}>
              No pay periods found.
            </Typography>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {periods.map((p) => (
                <Button
                  key={p.key}
                  variant="outlined"
                  onClick={() => handleAutoAssign(p)}
                  sx={{
                    fontWeight: 800,
                    color: p.color,
                    borderColor: p.isCurrent ? p.color : `${p.color}50`,
                    bgcolor: p.isCurrent ? `${p.color}18` : `${p.color}08`,
                    py: 1.25,
                    display: "flex",
                    flexDirection: "column",
                    gap: 0.25,
                    lineHeight: 1.3,
                    "&:hover": {
                      bgcolor: `${p.color}25`,
                      borderColor: p.color,
                    },
                  }}
                >
                  {p.label}
                  <Typography
                    component="span"
                    sx={{
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      color: p.color,
                      opacity: 0.75,
                      textTransform: "none",
                    }}
                  >
                    {p.dateRange}
                  </Typography>
                </Button>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Popover>
  );
};
