"use client";

/**
 * SandboxButton — the "Try a sandbox" entry point, in Settings → Data (it
 * sat in the Overview toolbar until Oct 27 2026, when the user moved the
 * rarely-used controls out of that toolbar). Entering copies the database and
 * reloads (see SandboxContext). While a sandbox is active it renders nothing:
 * the amber banner above every page already says so and owns Discard / Keep.
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
