"use client";

/**
 * SurplusTargetPill — inline editor for the weekly surplus target.
 *
 * Displays the current target ($X/wk) as a clickable pill in the Overview
 * toolbar; clicking opens a Popover with a number field. Value is persisted
 * to `AppSettings.wifeWeeklyTargetCents` (DB column name kept for backward
 * compat) via Refine's useUpdate. Draft state is only seeded on open so the
 * input keeps the user's typed value during the mutation's flight (no flash
 * back to old value).
 *
 * Consumed by the Overview header alongside the always-visible Optimize
 * button. Target drives split-personal distribution in CashFlowOverview
 * and PersonalOverview.
 */

import { useRef, useState } from "react";
import {
  Box,
  InputAdornment,
  Popover,
  TextField,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import { useOne, useUpdate } from "@refinedev/core";
import { fromCents, toCents } from "../../lib/cents";

export const SurplusTargetPill = () => {
  const { query } = useOne({
    resource: "AppSettings",
    id: "global",
  });
  const { mutate: updateSettings } = useUpdate();

  const settings = query.data?.data as any;
  const remoteCents: number = Number(settings?.wifeWeeklyTargetCents ?? 30000);

  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState<string>(String(fromCents(remoteCents)));
  const inputRef = useRef<HTMLInputElement | null>(null);

  // draft is only seeded on OPEN so that during the popup's close animation the
  // input keeps showing whatever the user just typed — no flash back to the old
  // value while the update mutation is in flight.
  const open = (e: React.MouseEvent<HTMLElement>) => {
    setDraft(String(fromCents(remoteCents)));
    setAnchor(e.currentTarget);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  // Only mutate when the value actually changed — cheap short-circuit that
  // avoids spurious Refine invalidations (which would re-render every
  // consumer of AppSettings). `successNotification:false` because the
  // Overview page already mounts AppSettings; a second success key would
  // collide and trigger React key warnings.
  const commit = () => {
    const cents = toCents(draft);
    if (cents !== remoteCents) {
      updateSettings({
        resource: "AppSettings",
        id: "global",
        values: { wifeWeeklyTargetCents: cents },
        successNotification: false,
      });
    }
    setDraft(String(fromCents(cents)));
    setAnchor(null);
  };

  const cancel = () => {
    setAnchor(null);
  };

  return (
    <>
      <Box
        component="button"
        onClick={open}
        sx={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.5,
          borderRadius: 2,
          bgcolor: "rgba(15, 23, 42, 0.5)",
          border: "1px solid rgba(129, 140, 248, 0.15)",
          transition: "border-color 120ms, background-color 120ms",
          "&:hover": {
            bgcolor: "rgba(129, 140, 248, 0.08)",
            borderColor: "rgba(129, 140, 248, 0.35)",
          },
          "&:hover .surplus-edit-icon": { color: "primary.light" },
        }}
      >
        <Box
          className="surplus-edit-icon"
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            color: "rgba(129, 140, 248, 0.7)",
            transition: "color 120ms",
          }}
        >
          <EditIcon sx={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ minWidth: 110, textAlign: "center" }}>
          <Typography
            sx={{
              fontWeight: 800,
              color: "white",
              fontSize: "0.95rem",
              letterSpacing: 0.3,
              lineHeight: 1.2,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            ${fromCents(remoteCents).toLocaleString()}
            <Box
              component="span"
              sx={{ color: "text.secondary", fontWeight: 600, ml: 0.5 }}
            >
              /wk
            </Box>
          </Typography>
          <Typography
            sx={{
              fontSize: "0.6rem",
              fontWeight: 900,
              letterSpacing: "1px",
              textTransform: "uppercase",
              color: "primary.light",
              mt: 0.3,
            }}
          >
            Surplus Target
          </Typography>
        </Box>
        <Box sx={{ width: 40 }} />
      </Box>

      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={cancel}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              p: 2,
              bgcolor: "rgba(15, 23, 42, 0.98)",
              border: "1px solid rgba(129, 140, 248, 0.25)",
              borderRadius: 2,
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            },
          },
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography
            sx={{ fontSize: "0.7rem", fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.8 }}
          >
            Surplus Target
          </Typography>
          <TextField
            inputRef={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            size="small"
            type="number"
            autoFocus
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">$</InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">/wk</InputAdornment>
                ),
              },
              htmlInput: {
                min: 0,
                step: 10,
                onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancel();
                  }
                },
              },
            }}
            sx={{ width: 180 }}
          />
          <Typography sx={{ fontSize: "0.7rem", color: "text.secondary" }}>
            Min surplus each pay week must clear after bills + personal.
          </Typography>

        </Box>
      </Popover>
    </>
  );
};
