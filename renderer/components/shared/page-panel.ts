/**
 * page-panel — the look every full-page list shares: the big rounded panel,
 * its title and its "create" button.
 *
 * Bills, Personal, Yearly Costs and Payees get it through ResourceList; the
 * Income page is not a ResourceList (it is cards, not a table) and used to
 * carry its own, narrower panel with a smaller title and a text button — it
 * looked like a different app (user feedback, Nov 25 2026). Both now read the
 * values from here, so the pages cannot drift apart again.
 *
 * Plain style objects on purpose (no component): ResourceList and IncomePage
 * lay their insides out differently, they only share the surface.
 */
import type { SxProps, Theme } from "@mui/material";

/**
 * Height of the outer wrapper. dvh, not vh: on a phone the browser's address
 * bar is part of 100vh, which would hide the bottom of the panel under it.
 */
export const PAGE_PANEL_HEIGHT = "calc(100dvh - 120px)";

/** The wrapper that centres the panel in the page. */
export const pagePanelOuterSx = (height: string = PAGE_PANEL_HEIGHT): SxProps<Theme> => ({
  height,
  p: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  overflow: "hidden",
});

/** The panel itself: as wide as the page allows (up to 1600px), full height. */
export const pagePanelSx: SxProps<Theme> = {
  width: "100%",
  maxWidth: 1600,
  // minWidth 0: a flex item's default min-width is its content width,
  // so the 400px search box used to push the whole card past the
  // right edge of a phone screen.
  minWidth: 0,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 2,
  p: { xs: 2, sm: 3 },
  bgcolor: "#1e293b",
  borderRadius: 2,
  border: "1px solid rgba(129, 140, 248, 0.2)",
  boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
  overflow: "hidden",
};

/** The row that holds the title and the create button. */
export const pageHeaderRowSx: SxProps<Theme> = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  // Title and button wrap onto two rows when they can't share one
  // (phone width) instead of the button's label breaking in half.
  flexWrap: "wrap",
  gap: 1.5,
};

/** The page title (use with `variant="h4"`). */
export const pageTitleSx: SxProps<Theme> = {
  fontWeight: 900,
  color: "white",
  fontSize: { xs: "1.75rem", sm: "2.125rem" },
};

/** The filled "Create New …" button at the right of the title. */
export const pageCreateButtonSx: SxProps<Theme> = {
  px: { xs: 2.5, sm: 4 },
  py: 1,
  borderRadius: 2,
  fontWeight: 800,
  whiteSpace: "nowrap",
  bgcolor: "primary.main",
  boxShadow: "0 4px 12px 0 rgba(129, 140, 248, 0.3)",
  "&:hover": {
    bgcolor: "primary.dark",
    boxShadow: "0 6px 16px 0 rgba(129, 140, 248, 0.4)",
    transform: "translateY(-1px)",
  },
  transition: "all 0.2s",
};
