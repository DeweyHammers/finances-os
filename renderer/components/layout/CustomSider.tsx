"use client";

import { useState, useMemo } from "react";
import {
  Box,
  Typography,
  Button,
  Collapse,
} from "@mui/material";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";
import PieChartIcon from "@mui/icons-material/PieChart";
import InsightsIcon from "@mui/icons-material/Insights";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import StorefrontIcon from "@mui/icons-material/Storefront";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import PersonIcon from "@mui/icons-material/Person";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import SettingsIcon from "@mui/icons-material/Settings";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import AddIcon from "@mui/icons-material/Add";
import { useRouter, usePathname } from "next/navigation";
import { useList } from "@refinedev/core";
import { computeAccountBalance } from "../../lib/budget-utils";
import { formatMoney } from "../../lib/cents";
import { SiderAccountRow } from "./SiderAccountRow";
import { AddAccountModal } from "../accounts/AddAccountModal";
import { EditAccountModal } from "../accounts/EditAccountModal";

interface NavLeafProps {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const NavLeaf = ({ href, label, icon }: NavLeafProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const normalized = (pathname || "/").replace(/\/index\.html$/, "") || "/";
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

export const CustomSider = () => {
  const [cashOpen, setCashOpen] = useState(true);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);

  const { query: accountsQuery } = useList({
    resource: "Account",
    pagination: { mode: "off" },
    sorters: [{ field: "sortOrder", order: "asc" }],
  });
  const { query: txnsQuery } = useList({
    resource: "AccountTransaction",
    pagination: { mode: "off" },
  });

  const accounts = (accountsQuery.data?.data as any[]) || [];
  const allTxns = (txnsQuery.data?.data as any[]) || [];

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

  const cashTotal = useMemo(
    () =>
      Array.from(balances.values()).reduce((acc, v) => acc + v, 0),
    [balances],
  );

  return (
    <Box
      sx={{
        width: 260,
        height: "100vh",
        flexShrink: 0,
        bgcolor: "background.paper",
        borderRight: "1px solid rgba(255,255,255,0.05)",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
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

      <GroupHeader label="Budget" />
      <NavLeaf href="/Plan" label="Plan" icon={<PieChartIcon />} />
      <NavLeaf
        href="/Statistics"
        label="Statistics"
        icon={<InsightsIcon />}
      />

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

      <Collapse in={cashOpen} timeout="auto">
        <Box>
          {accounts
            .filter((a) => !a.closed)
            .map((a) => (
              <SiderAccountRow
                key={a.id}
                id={a.id}
                name={a.name}
                balanceCents={balances.get(a.id) || 0}
                onEdit={(id) => setEditAccountId(id)}
              />
            ))}
          <Box sx={{ px: 1.5, pt: 0.5, pb: 0.5 }}>
            <Button
              fullWidth
              size="small"
              startIcon={<AddIcon sx={{ fontSize: 16 }} />}
              onClick={() => setAddAccountOpen(true)}
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

      <Box sx={{ flex: 1 }} />

      <NavLeaf
        href="/AppSettings"
        label="Settings"
        icon={<SettingsIcon />}
      />
      <Box sx={{ height: 16 }} />

      <AddAccountModal
        open={addAccountOpen}
        onClose={() => setAddAccountOpen(false)}
      />
      <EditAccountModal
        open={!!editAccountId}
        accountId={editAccountId}
        onClose={() => setEditAccountId(null)}
      />
    </Box>
  );
};
