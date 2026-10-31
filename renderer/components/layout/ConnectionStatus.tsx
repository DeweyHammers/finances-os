"use client";

/**
 * ConnectionStatus — the sync status row: a coloured dot plus two short
 * lines — green "Synced", amber-pulsing "Syncing…", amber "Offline · 3
 * changes waiting" (the app keeps working on the local copy; the changes go
 * up when the cloud is back), amber "Paused · sandbox", red "Update needed"
 * when the cloud database is newer than this app, red "Needs your choice"
 * when the cloud changed while this PC had unpushed changes (settled in
 * Settings → Phone & sync).
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
import SyncIcon from "@mui/icons-material/Sync";
import { useConnectionStatus, timeAgo, type ConnectionStatus as Status } from "../../lib/use-connection-status";
import { tooltipStyleProps, TooltipBody, TooltipTitle } from "../../lib/tooltip-styles";

const GREEN = "#3DBC83";
const RED = "#f43f5e";
const AMBER = "#fbbf24";

/**
 * Dot colour, label and the second line for each state. Every state has a
 * second line, "Synced" included ("Up to date with the cloud" — it stood
 * alone from Oct 29 to Oct 30 2026, then the user wanted a detail like the
 * other states). "Last synced …" lives only in the tooltip: on the row it
 * re-rendered once a minute and looked frozen (user feedback, Oct 28 2026);
 * a tooltip is computed when it opens, so it is always current.
 */
function describe(status: Status): { color: string; label: string; detail?: string; help: string } {
  const last = ` Last synced ${timeAgo(status.lastSyncedAt)}; the app checks the cloud every minute on its own.`;
  if (status.apiDown) {
    return { color: RED, label: "No answer", detail: "The app's server isn't responding", help: "The app's own API did not answer. Restarting the app usually fixes this." };
  }
  const pending = status.status?.pendingChanges ?? 0;
  const waiting = pending === 1 ? "1 change waiting" : `${pending} changes waiting`;
  switch (status.state) {
    case "syncing":
      return {
        color: AMBER,
        label: "Syncing…",
        detail: "Sending and receiving changes",
        help: "Sending this PC's changes to your cloud database and fetching the latest from it." + last,
      };
    case "synced":
      return {
        color: GREEN,
        label: "Synced",
        detail: "Up to date with the cloud",
        help:
          "Changes are saved on this PC at once and sent to your cloud database within a few seconds; other devices see them on their next sync." +
          last,
      };
    case "offline":
      if (status.status?.readOnly) {
        return {
          color: RED,
          label: "Offline",
          detail: "Read-only until the cloud is back",
          help:
            "This PC has no local copy of your cloud database yet and the cloud can't be reached to fetch it. The data from before sync was set up is shown read-only until it is back." +
            last,
        };
      }
      return {
        color: AMBER,
        label: "Offline",
        detail: pending > 0 ? waiting : "Can't reach the cloud",
        help:
          "The cloud database can't be reached. Keep working: everything is saved on this PC and sent to the cloud as soon as it is back." +
          (pending > 0 ? ` ${waiting}.` : "") +
          last,
      };
    case "conflict":
      return {
        color: RED,
        label: "Needs your choice",
        detail: pending > 0 ? `${waiting} · cloud changed too` : "The cloud changed too",
        help:
          "Your cloud database was changed from another device while this PC had changes that had not reached it yet. Nothing is merged or lost: open Settings → Phone & sync and choose which side to keep. Until then this PC keeps working on its own copy.",
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

  const described = describe(status);
  const { color, detail, help } = described;
  // A sync in flight (after a save, from the dot, or the server's own pull)
  // reads "Syncing…" and spins the arrows, but keeps the state's colour: a
  // save on a healthy connection shouldn't flash the card amber.
  const spinning = status.syncing && !status.apiDown;
  const label = spinning && status.state === "synced" ? "Syncing…" : described.label;
  const clickable = status.state !== "paused" && status.state !== "blocked" && status.state !== "conflict";

  return (
    <Box
      aria-label={`Sync: ${label}`}
      data-testid="sync-status"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        px: variant === "sider" ? 1.5 : 0,
        py: variant === "sider" ? 0.75 : 0,
        mx: variant === "sider" ? 1.5 : 0,
        // In the sider the row is boxed in a thin border in the state's
        // colour so it reads as a status card, not a stray line of text
        // (user request, Oct 28 2026). Still not a button: no hover.
        ...(variant === "sider"
          ? { border: `1px solid ${color}55`, borderRadius: "8px", bgcolor: `${color}0d` }
          : {}),
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
            // The dot; while a sync runs it becomes spinning arrows (user
            // request, Oct 29 2026). The arrows are 16px where the dot is
            // 10px — the negative margin keeps the label from shifting.
            width: spinning ? 16 : 10,
            height: spinning ? 16 : 10,
            mx: spinning ? "-3px" : 0,
            borderRadius: "50%",
            bgcolor: spinning ? "transparent" : color,
            boxShadow: spinning ? "none" : `0 0 8px ${color}99`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            cursor: clickable ? "pointer" : "default",
            "&:focus-visible": { outline: `2px solid ${color}80`, outlineOffset: 2 },
            // Pulse only while a plain status check is running.
            animation: status.checking && !spinning ? "fo-pulse 1s ease-in-out infinite" : "none",
            "@keyframes fo-pulse": {
              "0%, 100%": { opacity: 1 },
              "50%": { opacity: 0.35 },
            },
            // Material's Sync arrows point anticlockwise, so spin that way.
            "@keyframes fo-spin": { to: { transform: "rotate(-360deg)" } },
          }}
        >
          {spinning && (
            <SyncIcon
              data-testid="sync-spinner"
              sx={{ fontSize: 16, color, animation: "fo-spin 1s linear infinite" }}
            />
          )}
        </Box>
      </Tooltip>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: "0.8rem", fontWeight: 700, color: "#cbd5e1", lineHeight: 1.2 }}>
          {label}
        </Typography>
        {/* Second line: what the state means in a few words. */}
        {detail && (
          <Typography sx={{ fontSize: "0.68rem", color: "text.secondary", lineHeight: 1.2, whiteSpace: "nowrap" }}>
            {detail}
          </Typography>
        )}
      </Box>
    </Box>
  );
};
