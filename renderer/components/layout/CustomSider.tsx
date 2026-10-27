"use client";

/**
 * CustomSider — app-wide left navigation (replaces Refine.dev's default Sider).
 *
 * Hosts the logo, grouped nav leaves (Budget: Plan/Statistics/Cash/Payees,
 * Expenses: Overview/Bills/Personal/Yearly Costs/Income), and the expandable
 * Cash section which lists every open Account with its live balance. Also owns
 * the AddAccount / EditAccount modals so account CRUD flows can be triggered
 * from any page via the sider.
 *
 * Responsive behaviour (Oct 2026):
 *  - At `SIDER_BREAKPOINT` (md, 900px) and wider the sider is a permanent
 *    260px column pinned to the viewport, exactly as before.
 *  - Below that it leaves the flow and becomes a temporary MUI Drawer that
 *    slides in over the page. `MobileTopBar` (the ThemedLayout Header slot)
 *    shows the hamburger that opens it; both talk through Refine's
 *    ThemedLayout context (`mobileSiderOpen`). The drawer closes itself on
 *    any route change so tapping a leaf never leaves it open.
 *  The nav content itself (`SiderContent`) is shared by both modes, so the
 *  two can never drift apart.
 */

import { useState, useMemo, useEffect } from "react";
import {
  Box,
  Typography,
  Button,
  Collapse,
  Drawer,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useThemedLayoutContext } from "@refinedev/mui";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";
import PieChartIcon from "@mui/icons-material/PieChart";
import InsightsIcon from "@mui/icons-material/Insights";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import StorefrontIcon from "@mui/icons-material/Storefront";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import PersonIcon from "@mui/icons-material/Person";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import SavingsIcon from "@mui/icons-material/Savings";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import AddIcon from "@mui/icons-material/Add";
import SettingsIcon from "@mui/icons-material/Settings";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ConnectionStatus } from "./ConnectionStatus";
import { useSettingsDialog } from "../settings/SettingsDialogContext";
import { SIDER_BREAKPOINT } from "../../lib/constants";
import { useList } from "@refinedev/core";
import { computeAccountBalance } from "../../lib/budget-utils";
import { formatMoney } from "../../lib/cents";
import { SiderAccountRow } from "./SiderAccountRow";
import { AddAccountModal } from "../accounts/AddAccountModal";
import { EditAccountModal } from "../accounts/EditAccountModal";

/** Width of the permanent sider column AND of the narrow-window drawer. */
export const SIDER_WIDTH = 260;

/** MUI breakpoint key below which the sider becomes a drawer. `md` = 900px.
 *  Shared with MobileTopBar so the hamburger appears exactly when the column
 *  disappears — never both, never neither. Defined in lib/constants.ts and
 *  re-exported here for the existing importers. */
export { SIDER_BREAKPOINT };

// ── NavLeaf ──
// Single clickable nav row. Handles the "am I the active route?" highlight and
// keyboard activation (Enter). Kept private to this file — the sider is the
// only place that renders them.
interface NavLeafProps {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const NavLeaf = ({ href, label, icon }: NavLeafProps) => {
  const router = useRouter();
  const pathname = usePathname();
  // Nextron static export produces URLs ending in /index.html — strip that so
  // "/Overview/index.html" matches href="/Overview".
  const normalized = (pathname || "/").replace(/\/index\.html$/, "") || "/";
  // For non-root leaves, treat any path starting with `${href}/` as active so
  // nested routes (e.g. /Cash?id=…) keep the parent leaf highlighted.
  const active =
    href === "/"
      ? normalized === "/"
      : normalized === href || normalized.startsWith(`${href}/`);
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(href);
      }}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 2,
        py: 1.25,
        mx: 1.5,
        my: 0.25,
        borderRadius: "8px",
        cursor: "pointer",
        bgcolor: active ? "rgba(129, 140, 248, 0.15)" : "transparent",
        color: active ? "primary.light" : "#cbd5e1",
        "&:hover": {
          bgcolor: active
            ? "rgba(129, 140, 248, 0.20)"
            : "rgba(129, 140, 248, 0.08)",
        },
        "& svg": {
          color: active ? "primary.light" : "#94a3b8",
          fontSize: "1.2rem",
        },
      }}
    >
      {icon}
      <Typography sx={{ fontSize: "0.95rem", fontWeight: 600 }}>
        {label}
      </Typography>
    </Box>
  );
};

// ── GroupHeader ──
// Small uppercase caption used to separate "Budget" and "Expenses" groups.
const GroupHeader = ({ label }: { label: string }) => (
  <Typography
    sx={{
      px: 3,
      pt: 2,
      pb: 0.5,
      fontSize: "0.7rem",
      fontWeight: 900,
      letterSpacing: 1.5,
      color: "text.secondary",
      textTransform: "uppercase",
    }}
  >
    {label}
  </Typography>
);

// ── SiderContent ──
// Everything INSIDE the sider (logo, groups, Cash accounts, Add Account). It
// is rendered once by CustomSider, either inside the permanent column or
// inside the drawer, so the nav is defined in exactly one place.
interface SiderContentProps {
  onAddAccount: () => void;
  onEditAccount: (id: string) => void;
}

const SiderContent = ({ onAddAccount, onEditAccount }: SiderContentProps) => {
  // Cash section defaults to open so the user always sees their live balances
  // without an extra click on app launch.
  const [cashOpen, setCashOpen] = useState(true);

  // ── Data ──
  // Sorted by sortOrder so the user can drag-reorder accounts elsewhere and see
  // the ordering respected in the sider.
  const { query: accountsQuery } = useList({
    resource: "Account",
    pagination: { mode: "off" },
    sorters: [{ field: "sortOrder", order: "asc" }],
    // The sider is mounted on every route, so these queries always share their
    // resource with the page's own queries — silence notifications here to
    // avoid duplicate notification keys (see CLAUDE.md → "Refine
    // notifications"). Page-level queries still surface errors.
    successNotification: false,
    errorNotification: false,
  });
  // Pull ALL transactions once and bucket per-account in memory below. Cheaper
  // than N per-account queries for typical account counts (<20).
  const { query: txnsQuery } = useList({
    resource: "AccountTransaction",
    pagination: { mode: "off" },
    successNotification: false,
    errorNotification: false,
  });

  const accounts = (accountsQuery.data?.data as any[]) || [];
  const allTxns = (txnsQuery.data?.data as any[]) || [];

  // ── Derived: per-account balances ──
  // Closed accounts are excluded from the balance map (and rendered list) —
  // they still exist in the DB for history but shouldn't clutter navigation.
  const balances = useMemo(() => {
    const map = new Map<string, number>();
    accounts
      .filter((a) => !a.closed)
      .forEach((a) => {
        const txns = allTxns.filter((t) => t.accountId === a.id);
        map.set(a.id, computeAccountBalance(txns));
      });
    return map;
  }, [accounts, allTxns]);

  // Sum of all open-account balances shown next to the "Cash" section header.
  const cashTotal = useMemo(
    () =>
      Array.from(balances.values()).reduce((acc, v) => acc + v, 0),
    [balances],
  );

  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 2.5,
          py: 3,
        }}
      >
        <Box
          component="img"
          src="/images/logo.png"
          sx={{ width: 32, height: 32, borderRadius: 1 }}
        />
        <Typography
          variant="h6"
          sx={{
            color: "white",
            fontWeight: 800,
            letterSpacing: "-0.5px",
          }}
        >
          Finances OS
        </Typography>
      </Box>

      {/* ── Budget group ── */}
      <GroupHeader label="Budget" />
      <NavLeaf href="/Plan" label="Plan" icon={<PieChartIcon />} />
      <NavLeaf
        href="/Statistics"
        label="Statistics"
        icon={<InsightsIcon />}
      />

      {/* Cash section header — clickable to collapse/expand the account list.
          Not a NavLeaf because it doesn't route anywhere on its own; individual
          SiderAccountRow children route to /Cash?id=… */}
      <Box
        role="button"
        tabIndex={0}
        onClick={() => setCashOpen((v) => !v)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 1.25,
          mx: 1.5,
          my: 0.25,
          borderRadius: "8px",
          cursor: "pointer",
          "&:hover": { bgcolor: "rgba(129, 140, 248, 0.08)" },
        }}
      >
        <AccountBalanceIcon
          sx={{ color: "#94a3b8", fontSize: "1.2rem" }}
        />
        <Typography
          sx={{
            fontSize: "0.95rem",
            fontWeight: 700,
            color: "white",
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}
        >
          Cash
        </Typography>
        {cashOpen ? (
          <ExpandLessIcon sx={{ color: "#94a3b8", fontSize: "1.2rem" }} />
        ) : (
          <ExpandMoreIcon sx={{ color: "#94a3b8", fontSize: "1.2rem" }} />
        )}
        <Typography
          sx={{
            ml: "auto",
            fontSize: "0.9rem",
            fontWeight: 800,
            color: "white",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatMoney(cashTotal)}
        </Typography>
      </Box>

      {/* flexShrink: 0 — MUI Collapse sets `min-height: 0` on its root, so as a
          flex child of the sider column it was the ONLY item allowed to shrink
          when the window got short. Its rows then overflowed visibly on top of
          Payees / Expenses instead of pushing them down (the sider scrolls;
          nothing should ever shrink). */}
      <Collapse in={cashOpen} timeout="auto" sx={{ flexShrink: 0 }}>
        <Box>
          {accounts
            .filter((a) => !a.closed)
            .map((a) => (
              <SiderAccountRow
                key={a.id}
                id={a.id}
                name={a.name}
                balanceCents={balances.get(a.id) || 0}
                onEdit={onEditAccount}
              />
            ))}
          <Box sx={{ px: 1.5, pt: 0.5, pb: 0.5 }}>
            <Button
              fullWidth
              size="small"
              startIcon={<AddIcon sx={{ fontSize: 16 }} />}
              onClick={onAddAccount}
              sx={{
                bgcolor: "rgba(129, 140, 248, 0.18)",
                color: "primary.light",
                fontWeight: 700,
                textTransform: "none",
                borderRadius: 1.5,
                py: 0.4,
                fontSize: "0.8rem",
                minHeight: 0,
                border: "1px solid rgba(129, 140, 248, 0.3)",
                "&:hover": {
                  bgcolor: "rgba(129, 140, 248, 0.28)",
                  borderColor: "rgba(129, 140, 248, 0.5)",
                },
              }}
            >
              Add Account
            </Button>
          </Box>
        </Box>
      </Collapse>

      <NavLeaf href="/Payees" label="Payees" icon={<StorefrontIcon />} />

      {/* ── Expenses group ── */}
      <GroupHeader label="Expenses" />
      <NavLeaf
        href="/Overview"
        label="Overview"
        icon={<SpaceDashboardIcon />}
      />
      <NavLeaf href="/Bill" label="Bills" icon={<ReceiptLongIcon />} />
      <NavLeaf href="/Personal" label="Personal" icon={<PersonIcon />} />
      <NavLeaf
        href="/YearlyCosts"
        label="Yearly Costs"
        icon={<CalendarMonthIcon />}
      />
      <NavLeaf href="/Income" label="Income" icon={<SavingsIcon />} />

      {/* Flex spacer pushes the footer (Settings + connection status) to the
          bottom, like Obsidian's settings gear; the 16px box gives a little
          breathing room above the viewport edge. */}
      <Box sx={{ flex: 1 }} />
      <Box sx={{ pt: 2 }} />
      {/* Sync status — renders nothing until a sync server is configured, and
          sits ABOVE Settings so it is never in the way of that last click. */}
      <ConnectionStatus />
      {/* Settings is a popup over the current page, not a route. */}
      <SettingsLeaf />
      <Box sx={{ height: 16 }} />
    </>
  );
};

// ── SettingsLeaf ──
// Looks like a NavLeaf but goes through the Settings context: a popup on a
// desktop-width window, the /Settings page below the breakpoint (see
// components/settings/SettingsDialogContext.tsx). Highlighted while the
// popup is open or the page is showing.
const SettingsLeaf = () => {
  const { open, asPage, openSettings } = useSettingsDialog();
  const pathname = usePathname();
  const onPage = asPage && ((pathname || "/").replace(/\/index\.html$/, "") || "/").startsWith("/Settings");
  const active = open || onPage;
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => openSettings()}
      onKeyDown={(e) => {
        if (e.key === "Enter") openSettings();
      }}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 2,
        py: 1.25,
        mx: 1.5,
        my: 0.25,
        borderRadius: "8px",
        cursor: "pointer",
        bgcolor: active ? "rgba(129, 140, 248, 0.15)" : "transparent",
        color: active ? "primary.light" : "#cbd5e1",
        "&:hover": {
          bgcolor: active ? "rgba(129, 140, 248, 0.20)" : "rgba(129, 140, 248, 0.08)",
        },
        "& svg": { color: active ? "primary.light" : "#94a3b8", fontSize: "1.2rem" },
      }}
    >
      <SettingsIcon />
      <Typography sx={{ fontSize: "0.95rem", fontWeight: 600 }}>Settings</Typography>
    </Box>
  );
};

// Shared look of the sider surface in both modes — the permanent column and
// the drawer paper are styled identically so switching between them on a
// window resize doesn't visibly restyle anything.
const siderSurfaceSx = {
  width: SIDER_WIDTH,
  bgcolor: "background.paper",
  // MUI's dark-mode Paper adds a translucent white overlay image; the column
  // never had it, so strip it from the drawer too.
  backgroundImage: "none",
  borderRight: "1px solid rgba(255,255,255,0.05)",
  display: "flex",
  flexDirection: "column",
  overflowY: "auto",
  overflowX: "hidden",
  // The column scrolls when it is taller than the window; no row may shrink
  // (see the Cash <Collapse> note in SiderContent). The `flex: 1` spacer
  // keeps a 0 basis, so it still collapses to nothing.
  "& > *": { flexShrink: 0 },
} as const;

export const CustomSider = () => {
  const theme = useTheme();
  // No `noSsr`: the first client render must match the pre-rendered HTML
  // (Next's static export is built at desktop width), so a narrow window
  // shows the column for one frame after load and then switches to the
  // drawer. Reading the query synchronously instead caused a React hydration
  // mismatch. In jsdom (tests) `matchMedia` is absent and this is `false`,
  // i.e. the permanent column — the layout every existing test was written
  // for.
  const isNarrow = useMediaQuery(theme.breakpoints.down(SIDER_BREAKPOINT));
  const { mobileSiderOpen, setMobileSiderOpen } = useThemedLayoutContext();

  // Account CRUD modals live at the sider so they can be opened from any page
  // (add via the Cash section button, edit via SiderAccountRow's pencil icon).
  // They sit OUTSIDE the drawer so closing the drawer never unmounts a form
  // mid-edit.
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);

  // Close the drawer whenever the route changes. Cheaper and more robust than
  // threading an onNavigate callback through NavLeaf + SiderAccountRow: any
  // navigation (leaf, account row, KBar) collapses it.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams?.toString() ?? ""}`;
  useEffect(() => {
    setMobileSiderOpen(false);
    // setMobileSiderOpen is a stable context setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  const content = (
    <SiderContent
      onAddAccount={() => setAddAccountOpen(true)}
      onEditAccount={(id) => setEditAccountId(id)}
    />
  );

  return (
    <>
      {isNarrow ? (
        <Drawer
          variant="temporary"
          open={mobileSiderOpen}
          onClose={() => setMobileSiderOpen(false)}
          // keepMounted keeps the account queries warm so re-opening the
          // drawer shows balances instantly instead of a blank Cash list.
          ModalProps={{ keepMounted: true }}
          slotProps={{ paper: { sx: siderSurfaceSx } }}
        >
          {content}
        </Drawer>
      ) : (
        <Box
          sx={{
            ...siderSurfaceSx,
            flexShrink: 0,
            height: "100vh",
            // Dynamic viewport height ignores a mobile browser's collapsing
            // address bar; plain 100vh stays as the fallback for anything
            // that doesn't know dvh.
            "@supports (height: 100dvh)": { height: "100dvh" },
          }}
        >
          {content}
        </Box>
      )}

      <AddAccountModal
        open={addAccountOpen}
        onClose={() => setAddAccountOpen(false)}
      />
      <EditAccountModal
        open={!!editAccountId}
        accountId={editAccountId}
        onClose={() => setEditAccountId(null)}
      />
    </>
  );
};
