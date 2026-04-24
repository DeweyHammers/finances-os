"use client";

import { Refine } from "@refinedev/core";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";
import {
  useNotificationProvider,
  ThemedLayout,
  ThemedSider,
  SnackbarProvider,
} from "@refinedev/mui";
import routerProvider from "@refinedev/nextjs-router";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v13-appRouter";
import {
  CssBaseline,
  GlobalStyles,
  ThemeProvider,
  createTheme,
  Box,
  Typography,
} from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import dataProvider from "@refinedev/simple-rest";
import { Suspense, useState, useEffect, useMemo, ReactNode } from "react";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import PersonIcon from "@mui/icons-material/Person";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import SettingsIcon from "@mui/icons-material/Settings";
import WorkIcon from "@mui/icons-material/Work";
import BusinessIcon from "@mui/icons-material/Business";
import AssignmentIcon from "@mui/icons-material/Assignment";
import PaymentsIcon from "@mui/icons-material/Payments";
import CalculateIcon from "@mui/icons-material/Calculate";
import { COLORS } from "../lib/constants";

const API_URL = "http://localhost:8888/api";

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

const Title = () => (
  <Box
    sx={{
      display: "flex",
      alignItems: "center",
      gap: "12px",
      padding: "24px 16px",
      color: "primary.main",
      overflow: "hidden",
      width: "100%",
    }}
  >
    <Box
      component="img"
      src="/images/logo.png"
      sx={{
        width: 32,
        height: 32,
        flexShrink: 0,
        borderRadius: "6px",
      }}
    />
    <Typography
      variant="h6"
      sx={{
        color: "white",
        letterSpacing: "-0.5px",
        fontWeight: 800,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      Finances OS
    </Typography>
  </Box>
);

// Stable Sider component to prevent re-mounting
const CustomSider = () => (
  <Box
    sx={{
      width: 240,
      height: "100vh",
      flexShrink: 0,
      "& .MuiDrawer-paper": {
        width: 240,
        boxSizing: "border-box",
        borderRight: "1px solid rgba(255, 255, 255, 0.05)",
        bgcolor: "background.paper",
      },
    }}
  >
    <ThemedSider Title={Title} />
  </Box>
);

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

  const [settings, setSettings] = useState<{
    upworkActive: boolean;
    eddActive: boolean;
  } | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch(`${API_URL}/AppSettings/global`);
        if (!res.ok) return;
        const data = await res.json();
        setSettings((prev) => {
          if (
            prev &&
            prev.upworkActive === data.upworkActive &&
            prev.eddActive === data.eddActive
          ) {
            return prev;
          }
          return {
            upworkActive: data.upworkActive,
            eddActive: data.eddActive,
          };
        });
      } catch (e) {
        console.error("Failed to fetch settings for sidebar", e);
      }
    };

    fetchSettings();
    const interval = setInterval(fetchSettings, 5000);
    return () => clearInterval(interval);
  }, []);

  const resources = useMemo(() => {
    const allResources = [
      {
        name: "BillsGroup",
        meta: {
          label: "Expenses",
          icon: <AttachMoneyIcon />,
        },
      },
      {
        name: "UpWorkGroup",
        meta: {
          label: "UpWork",
          icon: <WorkIcon />,
        },
      },
      {
        name: "EddGroup",
        meta: {
          label: "EDD",
          icon: <PaymentsIcon />,
        },
      },
      {
        name: "Earning",
        list: "/Earning",
        meta: {
          label: "UpWork Income",
          parent: "UpWorkGroup",
          icon: <AttachMoneyIcon />,
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
        name: "EddPayment",
        list: "/EddPayment",
        meta: {
          label: "EDD Payments",
          parent: "EddGroup",
          icon: <AttachMoneyIcon />,
        },
      },
      {
        name: "JobReported",
        list: "/JobReported",
        meta: {
          label: "Job Reported",
          parent: "EddGroup",
          icon: <AssignmentIcon />,
        },
      },
      {
        name: "Client",
        list: "/Client",
        meta: {
          label: "Clients",
          parent: "UpWorkGroup",
          icon: <BusinessIcon />,
        },
      },
      {
        name: "Contract",
        list: "/Contract",
        meta: {
          label: "Contracts",
          parent: "UpWorkGroup",
          icon: <AssignmentIcon />,
        },
      },
      {
        name: "UpworkCalculator",
        list: "/UpworkCalculator",
        meta: {
          label: "Calculator",
          parent: "UpWorkGroup",
          icon: <CalculateIcon />,
        },
      },
      {
        name: "Taxes",
        list: "/Taxes",
        meta: {
          label: "Taxes",
          parent: "UpWorkGroup",
          icon: <ReceiptLongIcon />,
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
    ];

    if (!settings) return allResources;

    return allResources.filter((resource) => {
      if (
        resource.name === "UpWorkGroup" ||
        resource.meta?.parent === "UpWorkGroup"
      ) {
        return settings.upworkActive;
      }
      if (
        resource.name === "EddGroup" ||
        resource.meta?.parent === "EddGroup"
      ) {
        return settings.eddActive;
      }
      return true;
    });
  }, [settings]);

  const memoizedDataProvider = useMemo(() => dataProvider(API_URL), []);

  return (
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
      <ThemedLayout Header={CustomHeader} Sider={CustomSider}>
        <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
      </ThemedLayout>
      <RefineKbar />
    </Refine>
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
