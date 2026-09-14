"use client";

/**
 * providers.tsx — App-wide provider tree (Refine, MUI theme, IPC data provider).
 *
 * Wraps every route rendered by layout.tsx. Sets up:
 *  - Refine.dev CRUD framework with a REST data provider pointed at the local
 *    IPC bridge (main process exposes a fake REST server on localhost:5858).
 *  - Refine resources map — the sider menu and route resolution both key off
 *    this list. Adding a new route means adding a resource here.
 *  - MUI dark theme + global CSS overrides (sider styling, scrollbar polish,
 *    hidden ChevronLeft/Right icons — see CLAUDE.md "MUI icon gotcha").
 *  - Notification provider that swallows success toasts (we render our own
 *    Snackbars per-page for finer control).
 *  - MUI x-date-pickers localization, KBar command palette, snackbar host.
 */

import { Refine } from "@refinedev/core";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";
import {
  useNotificationProvider,
  ThemedLayout,
  SnackbarProvider,
} from "@refinedev/mui";
import { CustomSider } from "../components/layout/CustomSider";
import routerProvider from "@refinedev/nextjs-router";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v13-appRouter";
import {
  CssBaseline,
  GlobalStyles,
  ThemeProvider,
  createTheme,
} from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import dataProvider from "@refinedev/simple-rest";
import { Suspense, useMemo, ReactNode } from "react";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import PersonIcon from "@mui/icons-material/Person";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import SettingsIcon from "@mui/icons-material/Settings";
import PieChartIcon from "@mui/icons-material/PieChart";
import InsightsIcon from "@mui/icons-material/Insights";
import StorefrontIcon from "@mui/icons-material/Storefront";
import { COLORS } from "../lib/constants";

// IPC bridge address — the Electron main process spins up an in-memory REST
// server on this port that translates HTTP calls into Prisma queries against
// the SQLite database. Renderer never talks to Prisma directly.
const API_URL = "http://localhost:5858/api";

// ── MUI theme ──
// Dark palette matched to the Tailwind slate-900/slate-800 tokens used
// elsewhere in the app (via COLORS constants). Kept small and intentional —
// most component-level polish lives in the GlobalStyles block below.
const theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      // Bound to COLORS.gross so the "income green" accent stays consistent
      // between charts, sider highlights, and primary buttons.
      main: COLORS.gross,
    },
    background: {
      default: "#0f172a", // slate-900 — app canvas
      paper: "#1e293b",   // slate-800 — cards / dialogs
    },
    text: {
      primary: "#f8fafc",
      secondary: "#94a3b8",
    },
  },
  typography: {
    fontFamily: '"Inter", "Segoe UI", sans-serif',
    h4: { fontWeight: 800 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    subtitle1: { fontWeight: 600 },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          // Kill MUI's default ALL-CAPS button labels — every button in this
          // app uses sentence case.
          textTransform: "none",
          fontWeight: 600,
        },
      },
    },
  },
});

// ThemedLayout requires a Header slot but we don't want one (Electron chrome
// provides the window frame). Returning null here yields a headerless layout.
const CustomHeader = () => null;

// ── App shell (inside all providers) ──
// Split from Providers so we can call Refine/MUI hooks here — those hooks
// require the surrounding providers to already be mounted.
function App({ children }: { children: ReactNode }) {
  const originalNotificationProvider = useNotificationProvider();

  // Wrap Refine's notification provider to swallow success toasts globally.
  // Refine fires a success notification on every useCreate/useUpdate/useDelete
  // call, which would spam the user with duplicate messages when pages already
  // render their own targeted feedback. Error toasts still pass through.
  const notificationProvider = useMemo(
    () => ({
      ...originalNotificationProvider,
      open: (notification: any) => {
        if (notification.type === "success") return;
        originalNotificationProvider.open(notification);
      },
    }),
    [originalNotificationProvider],
  );

  // ── Refine resources ──
  // Each entry maps a model name (matching the Prisma model / REST path) to a
  // route + sider metadata. Entries without a `list` field (e.g. BudgetGroup,
  // BillsGroup, Account) are either sider-only grouping headers or "silent"
  // resources referenced by hooks but without their own page.
  const resources = useMemo(() => [
    // Sider header — groups Plan / Statistics / Payees under a "Budget" label.
    // No `list` field so it's a parent-only entry (see children below via
    // meta.parent = "BudgetGroup").
    {
      name: "BudgetGroup",
      meta: {
        label: "Budget",
        icon: <PieChartIcon />,
      },
    },
    {
      name: "Plan",
      list: "/Plan",
      meta: {
        label: "Plan",
        parent: "BudgetGroup",
        icon: <PieChartIcon />,
      },
    },
    {
      name: "Statistics",
      list: "/Statistics",
      meta: {
        label: "Statistics",
        parent: "BudgetGroup",
        icon: <InsightsIcon />,
      },
    },
    // "Silent" resources — no sider entry, no dedicated page, but registered
    // so useList/useOne hooks can reference them by name against the REST
    // provider. Account (cash accounts) is navigated via /Cash?id=... rather
    // than a sider link.
    { name: "Account" },
    {
      name: "Payee",
      list: "/Payees",
      meta: {
        label: "Payees",
        parent: "BudgetGroup",
        icon: <StorefrontIcon />,
      },
    },
    // More silent resources (transaction ledger rows, budget hierarchy tables)
    // — populated by the Plan and Cash pages via hooks.
    { name: "AccountTransaction" },
    { name: "BudgetCategoryGroup" },
    { name: "BudgetCategoryItem" },
    { name: "BudgetMonth" },
    // Sider header — groups Overview / Bills / Personal / Yearly Costs under
    // an "Expenses" label. Note: the group's internal name is BillsGroup but
    // it displays as "Expenses" to the user.
    {
      name: "BillsGroup",
      meta: {
        label: "Expenses",
        icon: <AttachMoneyIcon />,
      },
    },
    {
      name: "Overview",
      list: "/Overview",
      meta: {
        label: "Overview",
        parent: "BillsGroup",
        icon: <SpaceDashboardIcon />,
      },
    },
    {
      name: "Bill",
      list: "/Bill",
      meta: {
        label: "Bills",
        parent: "BillsGroup",
        icon: <ReceiptLongIcon />,
      },
    },
    {
      name: "Personal",
      list: "/Personal",
      meta: {
        label: "Personal",
        parent: "BillsGroup",
        icon: <PersonIcon />,
      },
    },
    {
      name: "YearlyCost",
      list: "/YearlyCosts",
      meta: {
        label: "Yearly Costs",
        parent: "BillsGroup",
        icon: <CalendarMonthIcon />,
      },
    },
    // Top-level (no parent) — Settings sits at the root of the sider.
    {
      name: "AppSettings",
      list: "/AppSettings",
      meta: {
        label: "Settings",
        icon: <SettingsIcon />,
      },
    },
  ], []);

  // simple-rest data provider — issues fetch() calls to API_URL. The Electron
  // main process listens on that port and translates them to Prisma queries.
  // Memoized so Refine's internal effect deps stay stable across renders.
  const memoizedDataProvider = useMemo(() => dataProvider(API_URL), []);

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <Refine
        routerProvider={routerProvider}
        dataProvider={memoizedDataProvider}
        notificationProvider={notificationProvider}
        resources={resources}
        options={{
          // Refine will read/write list filter/sort/pagination state into the
          // URL — handy for deep-linking a filtered view.
          syncWithLocation: true,
          // Off: our forms handle their own dirty state; the built-in modal
          // interrupts the Nextron nav flow.
          warnWhenUnsavedChanges: false,
        }}
      >
        <ThemedLayout
          Header={CustomHeader}
          Sider={CustomSider}
          // Lock the outer container to the viewport height so only the
          // children area scrolls — the sider stays pinned. Prevents the
          // Electron window from developing a double-scrollbar effect.
          containerBoxProps={{
            sx: { height: "100vh", overflow: "hidden" },
          }}
          childrenBoxProps={{
            sx: { overflowY: "auto", overflowX: "hidden" },
          }}
        >
          {children}
        </ThemedLayout>
        {/* KBar command palette (Cmd/Ctrl+K) — the provider wraps everything
            in <Providers> below; this renderer just mounts the overlay. */}
        <RefineKbar />
      </Refine>
    </Suspense>
  );
}

// ── Root export ──
// Order matters: KBar → MUI cache → theme → date-picker locale → snackbar →
// baseline → global styles → App. Refine sits inside App() because it needs
// theme + snackbar already mounted.
export function Providers({ children }: { children: ReactNode }) {
  return (
    <RefineKbarProvider>
      <AppRouterCacheProvider>
        <ThemeProvider theme={theme}>
          <LocalizationProvider dateAdapter={AdapterDateFns}>
            <SnackbarProvider>
              <CssBaseline />
              <GlobalStyles
                styles={{
                  // Match native font smoothing — MUI defaults to antialiased
                  // which looks too thin on our dark theme.
                  html: { WebkitFontSmoothing: "auto" },
                  // Hide the sider collapse/expand toggle. We don't want the
                  // user collapsing the sider — the layout assumes it's always
                  // expanded. Targets both the button and the underlying icons.
                  "button[aria-label='collapse'], button[aria-label='expand'], .MuiListItemButton-root[aria-label='collapse'], .MuiListItemButton-root[aria-label='expand'], .MuiListItemButton-root:has(svg[data-testid='ChevronLeftIcon']), .MuiListItemButton-root:has(svg[data-testid='ChevronRightIcon']), .MuiListItemButton-root:has(svg[data-testid='MenuOpenIcon'])":
                    {
                      display: "none !important",
                    },
                  // Global kill-switch for Chevron icons — see CLAUDE.md "MUI
                  // icon gotcha". Use NavigateBefore / NavigateNext everywhere
                  // else in the app if you need a chevron.
                  "svg[data-testid='ChevronLeftIcon'], svg[data-testid='ChevronRightIcon'], svg[data-testid='MenuOpenIcon']":
                    {
                      display: "none !important",
                    },
                  // Sider (Drawer) item polish — pill-shaped hoverable rows
                  // with indigo tinted hover/selected states. Overrides the
                  // default MUI list-item spacing which was too tight.
                  ".MuiDrawer-paper .MuiListItemButton-root": {
                    margin: "4px 12px",
                    borderRadius: "8px",
                    paddingTop: "8px",
                    paddingBottom: "8px",
                    "&:hover": {
                      backgroundColor: "rgba(129, 140, 248, 0.08)",
                    },
                  },
                  // Selected sider row — the current route. Recolors both text
                  // and icon to the primary accent (income green).
                  ".MuiDrawer-paper .MuiListItemButton-root.Mui-selected": {
                    backgroundColor: "rgba(129, 140, 248, 0.15)",
                    "&:hover": {
                      backgroundColor: "rgba(129, 140, 248, 0.20)",
                    },
                    "& .MuiListItemText-primary": {
                      color: COLORS.gross,
                      fontWeight: 800,
                    },
                    "& .MuiListItemIcon-root": {
                      color: COLORS.gross,
                    },
                  },
                  ".MuiDrawer-paper .MuiListItemText-primary": {
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    color: "#cbd5e1",
                  },
                  ".MuiDrawer-paper .MuiListItemIcon-root": {
                    minWidth: "36px",
                    color: "#94a3b8",
                  },
                  // Nested (child) items under a group header — indented and
                  // slightly smaller so the hierarchy reads visually.
                  ".MuiDrawer-paper .MuiCollapse-root .MuiListItemButton-root":
                    {
                      paddingLeft: "24px",
                    },
                  ".MuiDrawer-paper .MuiCollapse-root .MuiListItemText-primary":
                    {
                      fontSize: "0.9rem",
                      fontWeight: 500,
                    },
                  // Custom scrollbar styling — the default Chromium scrollbar
                  // looks jarring against the dark theme. Applied universally
                  // so panes, dropdowns, and dialogs all match.
                  "*::-webkit-scrollbar": {
                    width: "8px",
                    height: "8px",
                  },
                  "*::-webkit-scrollbar-track": {
                    background: "rgba(15, 23, 42, 0.5)",
                  },
                  "*::-webkit-scrollbar-thumb": {
                    background: "#334155",
                    borderRadius: "10px",
                    border: "2px solid rgba(15, 23, 42, 0.5)",
                  },
                  "*::-webkit-scrollbar-thumb:hover": {
                    background: "#475569",
                  },
                  // Hide number input spinners — every amount field in the app
                  // uses text-style entry with our own formatters.
                  "input::-webkit-outer-spin-button, input::-webkit-inner-spin-button":
                    {
                      WebkitAppearance: "none",
                      margin: 0,
                    },
                  "input[type=number]": {
                    MozAppearance: "textfield",
                  },
                }}
              />
              <App>{children}</App>
            </SnackbarProvider>
          </LocalizationProvider>
        </ThemeProvider>
      </AppRouterCacheProvider>
    </RefineKbarProvider>
  );
}
