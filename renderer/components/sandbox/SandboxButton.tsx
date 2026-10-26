"use client";

/**
 * SandboxButton — the "Try a sandbox" entry point. Lives in the Overview
 * toolbar next to Optimize (the user's choice, Oct 2026: that's where what-if
 * experiments get judged). Entering copies the database and reloads (see
 * SandboxContext). While a sandbox is active it renders nothing: the amber
 * banner directly above the page already says so and owns Discard / Keep.
 */

import { Button } from "@mui/material";
import ScienceIcon from "@mui/icons-material/Science";
import { useSandbox } from "./SandboxContext";
import { SANDBOX_AMBER } from "./SandboxBanner";

export const SandboxButton = () => {
  const { status, busy, run } = useSandbox();

  // No status yet (API still starting) or already in a sandbox → nothing.
  if (!status || status.active) return null;

  return (
    <Button
      variant="outlined"
      size="small"
      disableElevation
      startIcon={<ScienceIcon sx={{ fontSize: 14 }} />}
      disabled={busy}
      onClick={() => run("enter")}
      // Same shell as the Optimize button beside it, in amber so it reads as
      // "experiment" rather than "plan".
      sx={{
        fontWeight: 800,
        borderRadius: 2,
        fontSize: "0.75rem",
        borderColor: "rgba(251, 191, 36, 0.35)",
        color: SANDBOX_AMBER,
        "&:hover": {
          borderColor: SANDBOX_AMBER,
          bgcolor: "rgba(251, 191, 36, 0.08)",
        },
      }}
    >
      Try a sandbox
    </Button>
  );
};
