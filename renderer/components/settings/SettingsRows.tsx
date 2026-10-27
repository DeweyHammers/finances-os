"use client";

/**
 * The building blocks of a Settings tab (SettingsPage.tsx, SyncSection.tsx):
 * a `Section` is one tab's panel, a `Row` is label + explanation on the left
 * and the control(s) on the right, wrapping on phones.
 */
import { Box, Divider, Typography } from "@mui/material";

/** The card holding one tab's rows. */
export const Section = ({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontWeight: 800, color: "white", fontSize: "1.25rem", lineHeight: 1.2 }}>{title}</Typography>
    <Typography sx={{ color: "text.secondary", fontSize: "0.85rem", mb: 2 }}>{blurb}</Typography>
    <Box
      sx={{
        // Rows sit directly on the panel (Discord-style); the dividers do the
        // separating, so no second card inside the card.
        "& > hr:last-child": { display: "none" },
      }}
    >
      {children}
    </Box>
  </Box>
);

export interface RowProps {
  label: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}

/** One settings row: text on the left, control(s) on the right; wraps on phones. */
export const Row = ({ label, description, children }: RowProps) => (
  <>
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 2,
        py: 2.25,
      }}
    >
      <Box sx={{ flex: "1 1 260px", minWidth: 0 }}>
        <Typography sx={{ fontWeight: 700, color: "white", fontSize: "0.95rem" }}>{label}</Typography>
        {description && (
          <Typography sx={{ color: "text.secondary", fontSize: "0.83rem", mt: 0.25, overflowWrap: "anywhere" }}>
            {description}
          </Typography>
        )}
      </Box>
      {children && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, flexWrap: "wrap" }}>
          {children}
        </Box>
      )}
    </Box>
    <Divider sx={{ borderColor: "rgba(255,255,255,0.06)" }} />
  </>
);
