"use client";

/**
 * SyncBanner — the strip across the top of every page while changes can't
 * be saved: the cloud database is unreachable (red, "Offline"), or it was
 * written by a newer app (red, "Update needed"). Same place and shape as the
 * sandbox's amber strip (app/providers.tsx), for the same reason: every save
 * would be refused by the API (main/sync.ts → writeBlockReason), and a
 * per-form error toast is easy to miss or, for some forms, never shown.
 *
 * Renders nothing on a local-only install and whenever writes are allowed.
 * "Try again" asks the server to sync now; the banner disappears on its own
 * when the next status poll says writes are back.
 */
import { Box, Button, Typography } from "@mui/material";
import CloudOffIcon from "@mui/icons-material/CloudOff";
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import { useConnectionStatus } from "../../lib/use-connection-status";

const RED = "#f43f5e";

export const SyncBanner = () => {
  const connection = useConnectionStatus();
  const status = connection.status;
  if (!status?.configured || !status.writesBlocked) return null;

  const blocked = status.state === "blocked";
  const title = blocked ? "Update needed" : "Offline";

  return (
    <Box
      role="status"
      data-testid="sync-banner"
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 1.5,
        px: 2,
        py: 1,
        bgcolor: "rgba(244, 63, 94, 0.12)",
        borderBottom: `1px solid ${RED}`,
        backdropFilter: "blur(6px)",
      }}
    >
      {blocked ? (
        <SystemUpdateAltIcon sx={{ color: RED, fontSize: "1.2rem" }} />
      ) : (
        <CloudOffIcon sx={{ color: RED, fontSize: "1.2rem" }} />
      )}
      <Box sx={{ flex: 1, minWidth: 200 }}>
        <Typography sx={{ fontWeight: 800, color: RED, fontSize: "0.9rem", lineHeight: 1.2 }}>{title}</Typography>
        <Typography sx={{ color: "#e2e8f0", fontSize: "0.8rem", opacity: 0.85 }}>{status.writesBlocked}</Typography>
      </Box>
      {!blocked && (
        <Button
          size="small"
          variant="outlined"
          disabled={connection.checking}
          onClick={() => connection.syncNow()}
          sx={{
            ml: "auto",
            color: "#e2e8f0",
            borderColor: "rgba(226, 232, 240, 0.4)",
            fontWeight: 700,
            textTransform: "none",
            whiteSpace: "nowrap",
            "&:hover": { borderColor: "#e2e8f0", bgcolor: "rgba(226, 232, 240, 0.08)" },
          }}
        >
          {connection.checking ? "Checking…" : "Try again"}
        </Button>
      )}
    </Box>
  );
};
