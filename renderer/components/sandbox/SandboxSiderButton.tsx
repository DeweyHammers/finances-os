"use client";

/**
 * SandboxSiderButton — the "Try a sandbox" entry point at the bottom of the
 * sider. Entering copies the database and reloads (see SandboxContext). While
 * a sandbox is active the button turns into a passive amber label: Discard
 * and Keep live in the banner, which is visible on every page anyway.
 */

import { Box, Button, Typography } from "@mui/material";
import ScienceIcon from "@mui/icons-material/Science";
import { useSandbox } from "./SandboxContext";
import { SANDBOX_AMBER } from "./SandboxBanner";

export const SandboxSiderButton = () => {
  const { status, busy, run } = useSandbox();

  // No status yet (API still starting) → nothing to offer.
  if (!status) return null;

  if (status.active) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mx: 2.5,
          mb: 1,
          px: 1.5,
          py: 0.75,
          borderRadius: "8px",
          border: `1px solid ${SANDBOX_AMBER}`,
          bgcolor: "rgba(251, 191, 36, 0.10)",
          color: SANDBOX_AMBER,
        }}
      >
        <ScienceIcon sx={{ fontSize: "1.1rem" }} />
        <Typography sx={{ fontSize: "0.85rem", fontWeight: 700 }}>Sandbox active</Typography>
      </Box>
    );
  }

  return (
    <Button
      size="small"
      variant="outlined"
      startIcon={<ScienceIcon />}
      disabled={busy}
      onClick={() => run("enter")}
      sx={{
        mx: 2.5,
        mb: 1,
        color: "#94a3b8",
        borderColor: "rgba(148, 163, 184, 0.35)",
        fontWeight: 700,
        textTransform: "none",
        justifyContent: "flex-start",
        "&:hover": {
          color: SANDBOX_AMBER,
          borderColor: SANDBOX_AMBER,
          bgcolor: "rgba(251, 191, 36, 0.08)",
        },
      }}
    >
      Try a sandbox
    </Button>
  );
};
