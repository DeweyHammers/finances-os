"use client";

/**
 * IncomePage — standalone route wrapper around IncomesSection.
 *
 * The `IncomesSection` component is designed to be embedded (originally on
 * the Settings page). When the /Income route displays it as a full page, it
 * needs a centered, bordered container to give the section visual
 * boundaries. That container is this component's only responsibility.
 *
 * If you need to change the actual income CRUD UI, edit IncomesSection.tsx
 * (in this same directory) instead.
 */

import { Box } from "@mui/material";
import { IncomesSection } from "./IncomesSection";
import { COLORS } from "../../../lib/constants";

export function IncomePage() {
  return (
    // Outer centering wrapper — keeps the card in the middle of the viewport
    // and lets it shrink/grow with the window while preserving padding.
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        height: "100%",
        minHeight: 0,
        p: 4,
      }}
    >
      {/* Card container — matches the standalone-page aesthetic used by
          Settings sections when they're presented as full pages. */}
      <Box
        sx={{
          width: "100%",
          maxWidth: 1100,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          backgroundColor: "rgba(30, 41, 59, 0.5)",
          borderRadius: 4,
          position: "relative",
          border: `1px solid ${COLORS.gross}1a`,
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
        }}
      >
        {/* Inner scroll region — required because the card itself is
            overflow: hidden so its rounded corners clip cleanly. */}
        <Box sx={{ p: 4, overflowY: "auto", height: "100%" }}>
          <IncomesSection />
        </Box>
      </Box>
    </Box>
  );
}
