"use client";

import { Box } from "@mui/material";
import { IncomesSection } from "../../components/app-settings/sections/IncomesSection";
import { COLORS } from "../../lib/constants";

export default function IncomePage() {
  return (
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
        <Box sx={{ p: 4, overflowY: "auto", height: "100%" }}>
          <IncomesSection />
        </Box>
      </Box>
    </Box>
  );
}
