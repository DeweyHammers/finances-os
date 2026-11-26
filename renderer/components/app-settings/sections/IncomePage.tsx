"use client";

/**
 * IncomePage — the /Income route: IncomesSection inside the same page panel
 * as Bills, Personal, Yearly Costs and Payees.
 *
 * Those pages get their panel from ResourceList; Income is cards rather than
 * a table, so it borrows only the surface (shared/page-panel): the same
 * width (up to 1600px), height, colour, border and padding. Until Nov 25 2026
 * this page had its own narrower, more rounded and half-transparent card
 * with extra padding around it, and looked unlike every other page (user
 * feedback). The header (title + "Add Income") is inside IncomesSection.
 *
 * If you need to change the actual income CRUD UI, edit IncomesSection.tsx
 * (in this same directory) instead.
 */

import { Box } from "@mui/material";
import { IncomesSection } from "./IncomesSection";
import { pagePanelOuterSx, pagePanelSx } from "../../shared/page-panel";

export function IncomePage() {
  return (
    <Box sx={pagePanelOuterSx()}>
      <Box sx={pagePanelSx}>
        {/* Scroll region: the panel itself is overflow: hidden (its rounded
            corners clip cleanly), so a long list of incomes and paycheck
            tiles scrolls inside it. minHeight 0 lets it shrink within the
            panel's flex column; the small right padding keeps the scrollbar
            off the cards. */}
        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", pr: 0.5 }}>
          <IncomesSection />
        </Box>
      </Box>
    </Box>
  );
}
