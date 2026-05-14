"use client";

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

const API_URL = "http://localhost:5858/api";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: COLORS.gross,
    },
    background: {
      default: "#0f172a",
      paper: "#1e293b",
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
          textTransform: "none",
          fontWeight: 600,
        },
      },
    },
  },
});

const CustomHeader = () => null;

function App({ children }: { children: ReactNode }) {
  const originalNotificationProvider = useNotificationProvider();

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

  const resources = useMemo(() => [
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
    { name: "AccountTransaction" },
    { name: "BudgetCategoryGroup" },
    { name: "BudgetCategoryItem" },
    { name: "BudgetMonth" },
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
    {
      name: "AppSettings",
      list: "/AppSettings",
      meta: {
        label: "Settings",
        icon: <SettingsIcon />,
      },
    },
  ], []);

  const memoizedDataProvider = useMemo(() => dataProvider(API_URL), []);

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <Refine
        routerProvider={routerProvider}
        dataProvider={memoizedDataProvider}
        notificationProvider={notificationProvider}
        resources={resources}
        options={{
          syncWithLocation: true,
          warnWhenUnsavedChanges: false,
        }}
      >
        <ThemedLayout
          Header={CustomHeader}
          Sider={CustomSider}
          containerBoxProps={{
            sx: { height: "100vh", overflow: "hidden" },
          }}
          childrenBoxProps={{
            sx: { overflowY: "auto", overflowX: "hidden" },
          }}
        >
          {children}
        </ThemedLayout>
        <RefineKbar />
      </Refine>
    </Suspense>
  );
}

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
                  html: { WebkitFontSmoothing: "auto" },
                  "button[aria-label='collapse'], button[aria-label='expand'], .MuiListItemButton-root[aria-label='collapse'], .MuiListItemButton-root[aria-label='expand'], .MuiListItemButton-root:has(svg[data-testid='ChevronLeftIcon']), .MuiListItemButton-root:has(svg[data-testid='ChevronRightIcon']), .MuiListItemButton-root:has(svg[data-testid='MenuOpenIcon'])":
                    {
                      display: "none !important",
                    },
                  "svg[data-testid='ChevronLeftIcon'], svg[data-testid='ChevronRightIcon'], svg[data-testid='MenuOpenIcon']":
                    {
                      display: "none !important",
                    },
                  ".MuiDrawer-paper .MuiListItemButton-root": {
                    margin: "4px 12px",
                    borderRadius: "8px",
                    paddingTop: "8px",
                    paddingBottom: "8px",
                    "&:hover": {
                      backgroundColor: "rgba(129, 140, 248, 0.08)",
                    },
                  },
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
                  ".MuiDrawer-paper .MuiCollapse-root .MuiListItemButton-root":
                    {
                      paddingLeft: "24px",
                    },
                  ".MuiDrawer-paper .MuiCollapse-root .MuiListItemText-primary":
                    {
                      fontSize: "0.9rem",
                      fontWeight: 500,
                    },
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
                  // Hide number input spinners
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
