"use client";

/**
 * EmptyState — the "nothing here yet" card shown on a fresh install.
 *
 * Same visual language as the Overview's "No Income Added Yet" card: a tinted
 * icon tile (the page's own sidebar icon, in the section's accent color), a
 * bold title, one or two sentences on WHY this page matters, and a single
 * call-to-action. Used by the list pages (via ResourceList's `emptyState`),
 * the Plan, the Income page and the Overview's Yearly Costs section, so a
 * first-time user always knows what a page is for and what to do next.
 */

import { ReactNode } from "react";
import { Box, Button, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";

export interface EmptyStateProps {
  /** The page's icon (match the sidebar entry), rendered inside the tile. */
  icon: ReactNode;
  /** Section accent color (hex) — tints the tile, border and glow. */
  accent: string;
  title: string;
  /** Why the user should fill this in — what it unlocks elsewhere. */
  description: ReactNode;
  /** Optional call-to-action button. */
  actionLabel?: string;
  onAction?: () => void;
  /** Smaller paddings/icon for use inside a section or table. */
  compact?: boolean;
  /** Draw the dashed outline box (off when a parent already frames it). */
  framed?: boolean;
}

/** Hex "#rrggbb" → "rgba(r,g,b,a)" for the translucent tile/border tints. */
const tint = (hex: string, alpha: number) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

export const EmptyState = ({
  icon,
  accent,
  title,
  description,
  actionLabel,
  onAction,
  compact = false,
  framed = true,
}: EmptyStateProps) => (
  <Box
    sx={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: compact ? 2 : 2.5,
      py: compact ? 5 : 8,
      px: 3,
      // Unframed = inside a DataGrid overlay → fill it so the card centers.
      // Framed cards size to their content (a full-page stretch looks empty).
      height: framed ? "auto" : "100%",
      textAlign: "center",
      ...(framed && {
        bgcolor: "rgba(15, 23, 42, 0.3)",
        border: "1px dashed rgba(255,255,255,0.1)",
        borderRadius: 4,
      }),
    }}
  >
    {/* Icon tile — soft accent glow so the empty page still has a focal point. */}
    <Box
      sx={{
        p: compact ? 1.5 : 2,
        borderRadius: 3,
        display: "flex",
        color: accent,
        bgcolor: tint(accent, 0.1),
        border: `1px solid ${tint(accent, 0.25)}`,
        boxShadow: `0 0 32px ${tint(accent, 0.15)}`,
        "& svg": { fontSize: compact ? "2rem" : "2.5rem" },
      }}
    >
      {icon}
    </Box>
    <Box>
      <Typography variant={compact ? "h6" : "h5"} sx={{ fontWeight: 800, mb: 1, color: "white" }}>
        {title}
      </Typography>
      <Typography
        variant="body2"
        sx={{ color: "text.secondary", maxWidth: 460, mx: "auto", lineHeight: 1.6 }}
      >
        {description}
      </Typography>
    </Box>
    {actionLabel && onAction && (
      <Button
        variant="contained"
        disableElevation
        startIcon={<AddIcon />}
        onClick={onAction}
        sx={{ fontWeight: 800, borderRadius: 2, px: 3 }}
      >
        {actionLabel}
      </Button>
    )}
  </Box>
);
