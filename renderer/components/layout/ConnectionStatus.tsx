"use client";

/**
 * ConnectionStatus — the sync status row: a coloured dot plus two short
 * lines — green "Synced · last synced 3 min ago", amber-pulsing "Syncing…",
 * red "Offline · last synced 10:42", amber "Paused · sandbox", red "Update
 * needed" when the cloud database is newer than this app.
 *
 * It renders NOTHING until a cloud database is configured (see
 * useConnectionStatus): on a local-only install there is nothing to report
 * on, so the sider shows no row and Settings → Phone & sync says "Local
 * only" instead. Once it shows, the row sits just ABOVE Settings in the
 * sider as a plain status line — no hover highlight, not a button — so the
 * pointer never trips over it on the way to Settings (user feedback,
 * Oct 27 2026). Only the dot is interactive: hovering it explains the state,
 * clicking it syncs now.
 *
 * Reads the one shared poller (SyncStatusProvider) so the sider row and the
 * Settings page can never disagree.
 */
import { useEffect, useState } from "react";
import { Box, Tooltip, Typography } from "@mui/material";
import { useConnectionStatus, timeAgo, type ConnectionStatus as Status } from "../../lib/use-connection-status";
import { tooltipStyleProps, TooltipBody, TooltipTitle } from "../../lib/tooltip-styles";

const GREEN = "#3DBC83";
const RED = "#f43f5e";
const AMBER = "#fbbf24";

/** Dot colour, label and the second line for each state. */
function describe(status: Status): { color: string; label: string; detail: string; help: string } {
  const last = `Last synced ${timeAgo(status.lastSyncedAt)}`;
  if (status.apiDown) {
    return { color: RED, label: "No answer", detail: "The app's server isn't responding", help: "The app's own API did not answer. Restarting the app usually fixes this." };
  }
  switch (status.state) {
    case "syncing":
      return { color: AMBER, label: "Syncing…", detail: last, help: "Pulling the latest changes from your cloud database." };
    case "synced":
      return { color: GREEN, label: "Synced", detail: last, help: "Every change is saved to your cloud database as you make it; other devices see it on their next sync." };
    case "offline":
      return {
        color: RED,
        label: "Offline",
        detail: status.status?.readOnly ? "Read-only until the cloud is back" : last,
        help:
          "The cloud database can't be reached. You can look at everything; changes can't be saved until it is back. The app checks again every minute.",
      };
    case "paused":
      return { color: AMBER, label: "Paused", detail: "Sandbox active", help: "Sync is paused while the sandbox is active. Keep or Discard it to resume." };
    case "blocked":
      return {
        color: RED,
        label: "Update needed",
        detail: `Database is schema ${status.status?.schemaGate?.database ?? "?"}`,
        help: "Your cloud database was written by a newer version of Finances OS. Update the app on this device; until then nothing is synced or changed.",
      };
    default:
      return { color: AMBER, label: "Checking…", detail: "Reading the sync status", help: "Asking the app for its sync status." };
  }
}

interface ConnectionStatusProps {
  /** Wider layout for the Settings page row. */
  variant?: "sider" | "settings";
}

export const ConnectionStatus = ({ variant = "sider" }: ConnectionStatusProps) => {
  const status = useConnectionStatus();

  // Re-render once a minute so "3 min ago" stays honest without a poll.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Local only: nothing to be connected to, so nothing to show.
  if (!status.configured) return null;

  const { color, label, detail, help } = describe(status);
  const clickable = status.state !== "paused" && status.state !== "blocked";

  return (
    <Box
      aria-label={`Sync: ${label}`}
      data-testid="sync-status"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        px: variant === "sider" ? 2 : 0,
        py: variant === "sider" ? 1 : 0,
        mx: variant === "sider" ? 1.5 : 0,
      }}
    >
      {/* The dot is the only interactive part: hover for the detail, click to sync now. */}
      <Tooltip
        {...tooltipStyleProps(color)}
        title={
          <>
            <TooltipTitle color={color}>{label}</TooltipTitle>
            <TooltipBody>
              {help}
              {status.lastError ? ` Last error: ${status.lastError}` : ""}
              {clickable ? " Click to sync now." : ""}
            </TooltipBody>
          </>
        }
      >
        <Box
          role="button"
          tabIndex={0}
          aria-label={clickable ? "Sync now" : label}
          onClick={() => clickable && status.syncNow()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && clickable) status.syncNow();
          }}
          sx={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            bgcolor: color,
            boxShadow: `0 0 8px ${color}99`,
            flexShrink: 0,
            cursor: clickable ? "pointer" : "default",
            "&:focus-visible": { outline: `2px solid ${color}80`, outlineOffset: 2 },
            // Pulse only while a check or a sync is running.
            animation: status.checking ? "fo-pulse 1s ease-in-out infinite" : "none",
            "@keyframes fo-pulse": {
              "0%, 100%": { opacity: 1 },
              "50%": { opacity: 0.35 },
            },
          }}
        />
      </Tooltip>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: "0.8rem", fontWeight: 700, color: "#cbd5e1", lineHeight: 1.2 }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: "0.68rem", color: "text.secondary", lineHeight: 1.2, whiteSpace: "nowrap" }}>
          {detail}
        </Typography>
      </Box>
    </Box>
  );
};
