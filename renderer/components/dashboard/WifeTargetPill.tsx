"use client";

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

export const WifeTargetPill = () => {
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
          "&:hover .wife-edit-icon": { color: "primary.light" },
        }}
      >
        <Box
          className="wife-edit-icon"
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
            Wife Target
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
            Wife Target
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
