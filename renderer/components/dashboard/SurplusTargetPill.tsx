"use client";

/**
 * SurplusTargetPill — READ-ONLY display of the weekly surplus target in the
 * Overview toolbar ($X /wk), next to Optimize and the month picker.
 *
 * The pay-week cards are judged against this number, so it stays in view
 * here, but it is edited in ONE place only: Settings → Budget (user decision,
 * Oct 27 2026 — until then the pill opened an inline editor). Clicking the
 * pill opens that tab. Value comes from `AppSettings.wifeWeeklyTargetCents`
 * (DB column name kept for backward compat), default $300.
 */

import { Box, Tooltip, Typography } from "@mui/material";
import TrackChangesIcon from "@mui/icons-material/TrackChanges";
import { useOne } from "@refinedev/core";
import { useRouter } from "next/navigation";
import { fromCents } from "../../lib/cents";
import { tooltipStyleProps, TooltipBody, TooltipTitle } from "../../lib/tooltip-styles";

const ACCENT = "#818cf8";

export const SurplusTargetPill = () => {
  const router = useRouter();
  const { query } = useOne({
    resource: "AppSettings",
    id: "global",
    // Rendered inside OverviewPage, which reads the same AppSettings record —
    // see CLAUDE.md → "Refine notifications".
    successNotification: false,
    errorNotification: false,
  });

  const settings = query.data?.data as any;
  const remoteCents: number = Number(settings?.wifeWeeklyTargetCents ?? 30000);

  return (
    <Tooltip
      {...tooltipStyleProps(ACCENT)}
      title={
        <>
          <TooltipTitle color={ACCENT}>Surplus target</TooltipTitle>
          <TooltipBody>
            The minimum each pay week must clear after bills and personal spending. Change it in Settings → Budget.
          </TooltipBody>
        </>
      }
    >
      <Box
        component="button"
        aria-label="Surplus target — change it in Settings"
        onClick={() => router.push("/Settings?tab=budget")}
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
          transition: "border-color 120ms",
          "&:hover": { borderColor: "rgba(129, 140, 248, 0.35)" },
          "&:focus-visible": { outline: "2px solid rgba(129, 140, 248, 0.5)" },
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            color: "rgba(129, 140, 248, 0.7)",
          }}
        >
          <TrackChangesIcon sx={{ fontSize: 20 }} />
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
            <Box component="span" sx={{ color: "text.secondary", fontWeight: 600, ml: 0.5 }}>
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
    </Tooltip>
  );
};
