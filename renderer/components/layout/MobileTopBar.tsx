"use client";

/**
 * MobileTopBar — the ThemedLayout `Header` slot.
 *
 * Renders NOTHING at `SIDER_BREAKPOINT` (md, 900px) and wider: the permanent
 * sider column is visible there and Electron's own window frame is the only
 * chrome the app wants. Below that width the sider column is gone, so this
 * bar provides the hamburger that opens the sider drawer, plus the logo so
 * the page still identifies itself.
 *
 * The open state lives in Refine's ThemedLayout context (`mobileSiderOpen`),
 * which CustomSider reads — this component only ever sets it to true.
 */

import { Box, IconButton, Typography, useMediaQuery, useTheme } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import { useThemedLayoutContext } from "@refinedev/mui";
import { SIDER_BREAKPOINT } from "./CustomSider";

export const MobileTopBar = () => {
  const theme = useTheme();
  // Same query as CustomSider (and likewise without `noSsr`, to hydrate
  // cleanly) so the bar and the drawer always agree.
  const isNarrow = useMediaQuery(theme.breakpoints.down(SIDER_BREAKPOINT));
  const { setMobileSiderOpen } = useThemedLayoutContext();

  if (!isNarrow) return null;

  return (
    <Box
      component="header"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1,
        height: 52,
        flexShrink: 0,
        bgcolor: "background.paper",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {/* MenuIcon, not MenuOpenIcon — the latter is hidden app-wide by the
          GlobalStyles chevron kill-switch (see providers.tsx). */}
      <IconButton
        aria-label="Open navigation"
        onClick={() => setMobileSiderOpen(true)}
        sx={{ color: "#cbd5e1" }}
      >
        <MenuIcon />
      </IconButton>
      <Box
        component="img"
        src="/images/logo.png"
        alt=""
        sx={{ width: 26, height: 26, borderRadius: 1 }}
      />
      <Typography
        sx={{
          color: "white",
          fontWeight: 800,
          letterSpacing: "-0.5px",
          fontSize: "1.05rem",
        }}
      >
        Finances OS
      </Typography>
    </Box>
  );
};
