"use client";

/**
 * ConnectionStatus — the small "sync icon" row at the bottom of the sider
 * (and reused inside Settings → Sync). A coloured dot plus two short lines:
 * green "Connected · checked just now", red "Offline · last seen 10:42",
 * amber-pulsing while a check is in flight. Clicking it re-checks.
 *
 * Shares `useConnectionStatus` with the Settings page so the two can never
 * disagree. See plans/phone-app-and-sync.md for how this slot grows into
 * the sync status once the shared database exists.
 */
import { useEffect, useState } from "react";
import { Box, Tooltip, Typography } from "@mui/material";
import {
  useConnectionStatus,
  timeAgo,
  type ConnectionStatus as Status,
} from "../../lib/use-connection-status";
import { apiOrigin } from "../../lib/meta-api";
import { tooltipStyleProps, TooltipBody, TooltipTitle } from "../../lib/tooltip-styles";

const DOT = {
  connected: "#3DBC83",
  offline: "#f43f5e",
  unknown: "#fbbf24",
} as const;

const LABEL = {
  connected: "Connected",
  offline: "Offline",
  unknown: "Checking…",
} as const;

interface ConnectionStatusProps {
  /** Pass a status from the parent to share one poller; otherwise self-polls. */
  status?: Status;
  /** Wider layout for the Settings page row. */
  variant?: "sider" | "settings";
}

export const ConnectionStatus = ({ status: external, variant = "sider" }: ConnectionStatusProps) => {
  const own = useConnectionStatus(external ? 24 * 60 * 60 * 1000 : 30_000);
  const status = external ?? own;

  // Re-render once a minute so "3 min ago" stays honest without a poll.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const color = DOT[status.state];
  const detail =
    status.state === "offline"
      ? `Last seen ${timeAgo(status.lastOkAt)}`
      : status.state === "connected"
        ? `Checked ${timeAgo(status.lastOkAt)}`
        : "Reaching the database…";

  return (
    <Tooltip
      {...tooltipStyleProps(color)}
      title={
        <>
          <TooltipTitle color={color}>{LABEL[status.state]}</TooltipTitle>
          <TooltipBody>
            Database server at {apiOrigin()}.
            {status.lastError ? ` Last error: ${status.lastError}.` : ""}
            {" "}Click to check again.
          </TooltipBody>
        </>
      }
    >
      <Box
        role="button"
        tabIndex={0}
        aria-label={`Connection: ${LABEL[status.state]}`}
        onClick={() => status.refresh()}
        onKeyDown={(e) => {
          if (e.key === "Enter") status.refresh();
        }}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          px: variant === "sider" ? 2 : 0,
          py: variant === "sider" ? 1 : 0,
          mx: variant === "sider" ? 1.5 : 0,
          borderRadius: "8px",
          cursor: "pointer",
          "&:hover": { bgcolor: variant === "sider" ? "rgba(129, 140, 248, 0.08)" : "transparent" },
          "&:focus-visible": { outline: "2px solid rgba(129, 140, 248, 0.5)", outlineOffset: -2 },
        }}
      >
        <Box
          sx={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            bgcolor: color,
            boxShadow: `0 0 8px ${color}99`,
            flexShrink: 0,
            // Pulse only while a check is running.
            animation: status.checking ? "fo-pulse 1s ease-in-out infinite" : "none",
            "@keyframes fo-pulse": {
              "0%, 100%": { opacity: 1 },
              "50%": { opacity: 0.35 },
            },
          }}
        />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: "0.8rem", fontWeight: 700, color: "#cbd5e1", lineHeight: 1.2 }}>
            {LABEL[status.state]}
          </Typography>
          <Typography sx={{ fontSize: "0.68rem", color: "text.secondary", lineHeight: 1.2, whiteSpace: "nowrap" }}>
            {detail}
          </Typography>
        </Box>
      </Box>
    </Tooltip>
  );
};
