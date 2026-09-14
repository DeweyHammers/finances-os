/**
 * Shared MUI Tooltip styling used across the app so every hover popup reads
 * as one visual family: dark navy background, thin colored border + arrow,
 * Fade transition (no scale wobble), tight padding.
 *
 * The border color is the accent that ties the tooltip to its section —
 * amber (`TOOLTIP_AMBER`) for warning surfaces (Out of sync badge, Sync
 * Plan button), the pay-period color for a card's own tooltip (Bills /
 * CashFlow overviews so a pink Pay Week 2 card gets a pink tooltip
 * outline).
 *
 * Usage:
 *   <Tooltip
 *     {...tooltipStyleProps(period.color)}
 *     title={<>...</>}
 *     placement="top"
 *     arrow
 *   >
 *     ...
 *   </Tooltip>
 *
 * Content typography helpers (TooltipTitle + TooltipBody) provide the same
 * fontSize/lineHeight/weight the "Out of sync with plan" tooltip established,
 * so bodies stay consistent even when the content differs.
 */

import type { ReactNode } from "react";
import Fade from "@mui/material/Fade";
import Typography from "@mui/material/Typography";

/** Amber (matches the ⚠ WarningAmberIcon fill) — pass to
 *  `tooltipStyleProps` for warning-flavored tooltips. */
export const TOOLTIP_AMBER = "#fbbf24";

/** Converts a 6-char hex color (#RRGGBB) into `#RRGGBBAA` at the requested
 *  alpha. Used so callers can pass a solid section color and get a soft
 *  translucent border/arrow outline without hand-writing rgba() everywhere. */
const withAlpha = (hex: string, alpha: number): string => {
  const clamped = Math.max(0, Math.min(1, alpha));
  const suffix = Math.round(clamped * 255).toString(16).padStart(2, "0");
  return `${hex}${suffix}`;
};

/** Returns the `slots` + `slotProps` objects to spread onto a MUI Tooltip so
 *  it picks up the shared dark-bg / colored-border look. `borderColor` should
 *  be a hex string (#RRGGBB) — amber for warnings or the pay-period color
 *  for a section-owned tooltip. */
export const tooltipStyleProps = (borderColor: string) => {
  // 0.35 alpha for the outline — soft enough to feel like an accent rather
  // than a hard boundary, matches the original "Out of sync" tooltip.
  const borderRule = `1px solid ${withAlpha(borderColor, 0.35)}`;
  return {
    slots: { transition: Fade },
    slotProps: {
      // 150ms Fade is snappy enough to feel responsive without the visible
      // scale-transform wobble MUI's default Grow causes.
      transition: { timeout: 150 },
      tooltip: {
        sx: {
          bgcolor: "rgb(15, 23, 42)",
          border: borderRule,
          borderRadius: 2,
          // Padding lives on the tooltip itself (not a nested Box) so MUI's
          // initial size measurement matches the rendered size — otherwise
          // the tooltip visibly reflows one frame after opening.
          px: 1.25,
          py: 1,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          // Arrow is a rotated square rendered via ::before. Extending the
          // border onto ::before continues the outline onto the arrow's two
          // exposed sides — without this the border visibly "cuts off" at
          // the arrow's base.
          "& .MuiTooltip-arrow": {
            color: "rgb(15, 23, 42)",
            "&::before": {
              border: borderRule,
              backgroundColor: "rgb(15, 23, 42)",
            },
          },
          maxWidth: 280,
        },
      },
    },
  };
};

/** Bold accent-colored title line inside a tooltip. Color usually matches
 *  the borderColor passed to `tooltipStyleProps` so the tooltip feels
 *  cohesive top-to-bottom. */
export const TooltipTitle: React.FC<{ color: string; children: ReactNode }> = ({
  color,
  children,
}) => (
  <Typography
    sx={{
      fontSize: "0.78rem",
      fontWeight: 800,
      color,
      mb: 0.5,
      lineHeight: 1.35,
    }}
  >
    {children}
  </Typography>
);

/** Body text inside a tooltip — muted white so the accent title reads first. */
export const TooltipBody: React.FC<{ children: ReactNode }> = ({ children }) => (
  <Typography
    sx={{
      fontSize: "0.72rem",
      color: "rgba(255,255,255,0.85)",
      lineHeight: 1.4,
    }}
  >
    {children}
  </Typography>
);
