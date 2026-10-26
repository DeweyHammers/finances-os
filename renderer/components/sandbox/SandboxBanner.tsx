"use client";

/**
 * SandboxBanner — the amber strip across the top of every page while a
 * sandbox is active. Rendered by the layout (app/providers.tsx) just above
 * the routed page, sticky so it never scrolls out of view: the whole point is
 * that you can't forget you're on a copy.
 *
 *   Discard → back to the real data, the copy is deleted. Confirmed first,
 *             and the dialog says how many transactions were recorded in the
 *             sandbox, since those are the edits most likely to be real.
 *   Keep    → the copy REPLACES the real data (a timestamped .bak of the real
 *             file is written first, see main/sandbox.ts). Confirmed first.
 *
 * Both reload the window on success (see SandboxContext).
 */

import { useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Typography,
} from "@mui/material";
import ScienceIcon from "@mui/icons-material/Science";
import { useSandbox } from "./SandboxContext";

/** Same amber as the Plan page's out-of-sync warning surfaces. */
export const SANDBOX_AMBER = "#fbbf24";

type Pending = "discard" | "keep" | null;

export const SandboxBanner = () => {
  const { status, busy, error, run } = useSandbox();
  const [pending, setPending] = useState<Pending>(null);

  if (!status?.active) return null;

  const added = status.transactionsAdded;
  const addedText =
    added === 0
      ? "No transactions were recorded in the sandbox."
      : `${added} transaction${added === 1 ? " was" : "s were"} recorded in the sandbox and will be lost.`;

  const confirm = async () => {
    const action = pending;
    setPending(null);
    if (action) await run(action);
  };

  return (
    <>
      <Box
        role="status"
        data-testid="sandbox-banner"
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
          bgcolor: "rgba(251, 191, 36, 0.12)",
          borderBottom: `1px solid ${SANDBOX_AMBER}`,
          backdropFilter: "blur(6px)",
        }}
      >
        <ScienceIcon sx={{ color: SANDBOX_AMBER, fontSize: "1.2rem" }} />
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography sx={{ fontWeight: 800, color: SANDBOX_AMBER, fontSize: "0.9rem", lineHeight: 1.2 }}>
            Sandbox
          </Typography>
          <Typography sx={{ color: "#e2e8f0", fontSize: "0.8rem", opacity: 0.85 }}>
            {error
              ? `Sandbox action failed: ${error}`
              : "You're working on a copy. Nothing here touches your real data until you choose Keep."}
          </Typography>
        </Box>
        {/* Grouped so a narrow window wraps both buttons together under the
            text instead of stranding Keep on its own line. */}
        <Box sx={{ display: "flex", gap: 1.5, ml: "auto" }}>
          <Button
            size="small"
            variant="outlined"
            disabled={busy}
            onClick={() => setPending("discard")}
            sx={{
              color: "#e2e8f0",
              borderColor: "rgba(226, 232, 240, 0.4)",
              fontWeight: 700,
              textTransform: "none",
              "&:hover": { borderColor: "#e2e8f0", bgcolor: "rgba(226, 232, 240, 0.08)" },
            }}
          >
            Discard
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={busy}
            onClick={() => setPending("keep")}
            sx={{
              bgcolor: SANDBOX_AMBER,
              color: "#1e1b4b",
              fontWeight: 800,
              textTransform: "none",
              "&:hover": { bgcolor: "#f59e0b" },
            }}
          >
            Keep
          </Button>
        </Box>
      </Box>

      <Dialog open={pending !== null} onClose={() => setPending(null)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 800 }}>
          {pending === "keep" ? "Keep the sandbox?" : "Discard the sandbox?"}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: "#cbd5e1" }}>
            {pending === "keep"
              ? "Your real data will be replaced with everything you did in the sandbox. A backup of the current real data is saved first."
              : `Everything you did in the sandbox will be thrown away and the app will go back to your real data. ${addedText}`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={confirm}
            color={pending === "keep" ? "primary" : "error"}
            sx={{ textTransform: "none", fontWeight: 700 }}
          >
            {pending === "keep" ? "Keep changes" : "Discard changes"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
