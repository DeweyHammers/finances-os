"use client";

/**
 * SettingsPage — the Settings content, laid out like Obsidian's and Discord's
 * settings: a narrow nav of tabs on the left, ONE section at a time on the
 * right as a panel of rows (label + explanation left, control right). On a
 * desktop-width window it is shown inside SettingsDialog (a popup, with the
 * close button); below the sider breakpoint it is the /Settings page (see
 * SettingsDialogContext for the rule).
 *
 *  general  — version + "Check for updates" (GitHub Releases), help, issues
 *  budget   — surplus target (the ONLY place it is edited; the Overview pill
 *             is read-only and opens this tab), link to the Income page
 *  data     — where the database is, backups ("Back up now" → .bak beside it
 *             via /api/backups), the "Try a sandbox" entry point
 *  sync     — run mode, "Local only" until a sync server exists, and what
 *             sync will be (plans/phone-app-and-sync.md): no controls yet
 *
 * The open tab is a prop: dialog state in the popup, the `?tab=` query on
 * the page (read by app/Settings/page.tsx). Below the `md` breakpoint the
 * nav becomes a horizontal strip above the rows.
 *
 * Non-resource calls go through lib/meta-api.ts; the surplus target goes
 * through Refine like everywhere else.
 */

import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  Fade,
  IconButton,
  InputAdornment,
  Snackbar,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import BackupIcon from "@mui/icons-material/Backup";
import SettingsIcon from "@mui/icons-material/Settings";
import CloseIcon from "@mui/icons-material/Close";
import TuneIcon from "@mui/icons-material/Tune";
import SavingsIcon from "@mui/icons-material/Savings";
import StorageIcon from "@mui/icons-material/Storage";
import SyncIcon from "@mui/icons-material/Sync";
import { useOne, useUpdate } from "@refinedev/core";
import { useRouter } from "next/navigation";
import { fromCents, toCents } from "../../lib/cents";
import {
  apiOrigin,
  cachedBackups,
  cachedMeta,
  createBackup,
  fetchUpdateCheck,
  loadBackups,
  loadMeta,
  MODE_LABELS,
  type AppMeta,
  type BackupInfo,
  type UpdateCheck,
} from "../../lib/meta-api";
import { useConnectionStatus } from "../../lib/use-connection-status";
import { useSandbox } from "../sandbox/SandboxContext";
import { SandboxButton } from "../sandbox/SandboxButton";
import { ConnectionStatus } from "../layout/ConnectionStatus";
import type { SettingsTab } from "./SettingsDialogContext";

// ── Tabs ────────────────────────────────────────────────────────────────────

const TABS: { id: SettingsTab; label: string; blurb: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", blurb: "Version, updates and help.", icon: <TuneIcon /> },
  { id: "budget", label: "Budget", blurb: "The numbers the plan is built around.", icon: <SavingsIcon /> },
  { id: "data", label: "Data", blurb: "Where your data lives, backups and the sandbox.", icon: <StorageIcon /> },
  { id: "sync", label: "Phone & sync", blurb: "This device, other devices and what sync will be.", icon: <SyncIcon /> },
];

// ── Layout helpers ──────────────────────────────────────────────────────────

/** The card holding one tab's rows. */
const Section = ({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) => (
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

interface RowProps {
  label: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}

/** One settings row: text on the left, control(s) on the right; wraps on phones. */
const Row = ({ label, description, children }: RowProps) => (
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

/** The left-hand tab list (a horizontal strip below `md`). */
const TabNav = ({ active, onSelect }: { active: SettingsTab; onSelect: (tab: SettingsTab) => void }) => {
  // On the phone strip the open tab can start off-screen (a link straight
  // to ?tab=sync); bring it into view without jumping the page.
  const activeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
  <Box
    role="tablist"
    aria-label="Settings sections"
    sx={{
      display: "flex",
      flexDirection: { xs: "row", md: "column" },
      gap: 0.5,
      overflowX: { xs: "auto", md: "visible" },
      // Room for the focus ring / shadow on the strip; none needed as a column.
      pb: { xs: 0.5, md: 0 },
      flexShrink: 0,
    }}
  >
    {TABS.map((tab) => {
      const selected = tab.id === active;
      return (
        <Box
          key={tab.id}
          ref={selected ? activeRef : undefined}
          role="tab"
          aria-selected={selected}
          tabIndex={0}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(tab.id);
            }
          }}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            px: 1.5,
            py: 1,
            borderRadius: 2,
            cursor: "pointer",
            whiteSpace: "nowrap",
            userSelect: "none",
            color: selected ? "white" : "text.secondary",
            bgcolor: selected ? "rgba(129, 140, 248, 0.15)" : "transparent",
            fontWeight: selected ? 800 : 600,
            fontSize: "0.9rem",
            transition: "background-color 120ms, color 120ms",
            "&:hover": { bgcolor: selected ? "rgba(129, 140, 248, 0.2)" : "rgba(129, 140, 248, 0.08)", color: "white" },
            "&:focus-visible": { outline: "2px solid rgba(129, 140, 248, 0.5)", outlineOffset: -2 },
            "& svg": { fontSize: 20, color: selected ? "primary.light" : "inherit" },
          }}
        >
          {tab.icon}
          {tab.label}
        </Box>
      );
    })}
  </Box>
  );
};

const linkButton = {
  variant: "outlined" as const,
  size: "small" as const,
  endIcon: <OpenInNewIcon sx={{ fontSize: "14px !important" }} />,
  sx: { fontWeight: 700, borderRadius: 2, whiteSpace: "nowrap" },
  target: "_blank",
  rel: "noreferrer",
};

// ── Page ────────────────────────────────────────────────────────────────────

interface SettingsPageProps {
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  /** Present inside the popup: renders the close button. Absent on the page form. */
  onClose?: () => void;
}

export const SettingsPage = ({ tab: active, onTabChange: selectTab, onClose }: SettingsPageProps) => {
  const router = useRouter();
  const activeTab = TABS.find((t) => t.id === active) ?? TABS[0];

  // App facts — usually already cached (prefetched at app start), so the
  // first render has them and the link buttons never blink disabled.
  const [meta, setMeta] = useState<AppMeta | null>(cachedMeta);
  const [metaError, setMetaError] = useState<string | null>(null);
  useEffect(() => {
    loadMeta().then(setMeta).catch((e) => setMetaError(e.message));
  }, []);

  // Update check
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const checkUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateError(null);
    try {
      setUpdate(await fetchUpdateCheck());
    } catch (e: any) {
      setUpdateError(e.message);
    } finally {
      setCheckingUpdate(false);
    }
  };

  // Surplus target — the one editor; the Overview pill only displays it.
  const { query: settingsQuery } = useOne({
    resource: "AppSettings",
    id: "global",
    successNotification: false,
    errorNotification: false,
  });
  const { mutate: updateSettings } = useUpdate();
  const remoteCents = Number((settingsQuery.data?.data as any)?.wifeWeeklyTargetCents ?? 30000);
  const [surplusDraft, setSurplusDraft] = useState<string | null>(null);
  // Cents sent by the last Save, until the server reports them back. The
  // draft stays on screen meanwhile: clearing it on Save showed the OLD
  // stored amount for the length of the round trip.
  const [surplusPending, setSurplusPending] = useState<number | null>(null);
  const surplusValue = surplusDraft ?? String(fromCents(remoteCents));
  const surplusDirty = surplusDraft !== null && toCents(surplusDraft) !== remoteCents;
  const saveSurplus = () => {
    if (!surplusDirty) return;
    const cents = toCents(surplusValue);
    setSurplusPending(cents);
    updateSettings({
      resource: "AppSettings",
      id: "global",
      values: { wifeWeeklyTargetCents: cents },
      successNotification: false,
    });
  };
  useEffect(() => {
    if (surplusPending !== null && remoteCents === surplusPending) {
      setSurplusPending(null);
      setSurplusDraft(null);
    }
  }, [remoteCents, surplusPending]);

  // Backups
  const [backups, setBackups] = useState<BackupInfo | null>(cachedBackups);
  const [backingUp, setBackingUp] = useState(false);
  useEffect(() => {
    loadBackups().then(setBackups).catch(() => {});
  }, []);
  // Toast (CLAUDE.md → "Toast pattern"): message kept until the exit animation ends.
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const toast = (msg: string) => {
    setToastMsg(msg);
    setToastOpen(true);
  };
  const backUpNow = async () => {
    setBackingUp(true);
    try {
      const r = await createBackup();
      setBackups(r);
      toast(`Backup saved: ${r.file.split(/[\\/]/).pop()}`);
    } catch (e: any) {
      toast(`Backup failed: ${e.message}`);
    } finally {
      setBackingUp(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      toast("Could not copy");
    }
  };

  const sandbox = useSandbox();
  const connection = useConnectionStatus();

  const modeLabel = meta ? MODE_LABELS[meta.mode] : "…";
  const onThisPc = meta?.mode !== "hosted";

  // ── Sections ──

  const general = (
    <Section key="general" title="General" blurb={activeTab.blurb}>
      <Row
        label={meta ? `Version ${meta.version}` : "Version"}
        description={
          metaError
            ? `Could not read app info: ${metaError}`
            : meta
              ? `${modeLabel} · ${meta.platform === "win32" ? "Windows" : meta.platform}`
              : "Loading…"
        }
      >
        <Button
          variant="contained"
          size="small"
          disableElevation
          startIcon={<SystemUpdateAltIcon />}
          onClick={checkUpdates}
          disabled={checkingUpdate}
          sx={{ fontWeight: 800, borderRadius: 2, whiteSpace: "nowrap" }}
        >
          {checkingUpdate ? "Checking…" : "Check for updates"}
        </Button>
      </Row>
      {(update || updateError) && (
        <Row
          label={
            updateError
              ? "Update check failed"
              : update?.updateAvailable
                ? `Version ${update.latest} is available`
                : "You're up to date"
          }
          description={
            updateError
              ? updateError
              : update?.updateAvailable
                ? "Download the new installer from the Release page and run it; your data stays where it is."
                : `Latest release is ${update?.latest}.`
          }
        >
          {update?.updateAvailable && (
            <Button {...linkButton} href={update.url} component="a">
              Download
            </Button>
          )}
        </Row>
      )}
      <Row label="Help" description="The picture tour walks through every page and feature.">
        <Button {...linkButton} href={meta?.docsUrl ?? "#"} component="a" disabled={!meta}>
          Open guide
        </Button>
      </Row>
      <Row label="Report a problem" description="Found a bug or have an idea? Open an issue on GitHub.">
        <Button {...linkButton} href={meta?.issuesUrl ?? "#"} component="a" disabled={!meta}>
          GitHub issues
        </Button>
      </Row>
    </Section>
  );

  const budget = (
    <Section key="budget" title="Budget" blurb={activeTab.blurb}>
      <Row
        label="Surplus target"
        description="The minimum each pay week must clear after bills and personal spending. Optimize plans bill splits around it. The Overview shows it next to the pay weeks; this is the only place to change it."
      >
        <TextField
          size="small"
          type="number"
          value={surplusValue}
          onChange={(e) => setSurplusDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveSurplus();
          }}
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start">$</InputAdornment>,
              endAdornment: <InputAdornment position="end">/wk</InputAdornment>,
            },
            htmlInput: { min: 0, step: 10, inputMode: "decimal" },
          }}
          sx={{ width: 170 }}
        />
        <Button
          variant="contained"
          size="small"
          disableElevation
          onClick={saveSurplus}
          disabled={!surplusDirty}
          sx={{ fontWeight: 800, borderRadius: 2 }}
        >
          Save
        </Button>
      </Row>
      <Row
        label="Pay schedule"
        description="Paydays and the weekly / bi-weekly cycle come from your Primary income."
      >
        <Button
          variant="outlined"
          size="small"
          onClick={() => {
            // Leaving for another page: the popup closes behind the navigation.
            onClose?.();
            router.push("/Income");
          }}
          sx={{ fontWeight: 700, borderRadius: 2, whiteSpace: "nowrap" }}
        >
          Open Income
        </Button>
      </Row>
    </Section>
  );

  const data = (
    <Section key="data" title="Data" blurb={activeTab.blurb}>
      <Row
        label="Database"
        description={
          meta ? (
            <>
              {onThisPc ? "Your data lives in this file on this PC. " : "Your data lives on the server. "}
              <Box component="code" sx={{ fontSize: "0.78rem", color: "#cbd5e1" }}>
                {meta.databasePath}
              </Box>
            </>
          ) : (
            "Loading…"
          )
        }
      >
        <Tooltip title="Copy path">
          <span>
            <IconButton size="small" onClick={() => meta && copy(meta.databasePath)} disabled={!meta}>
              <ContentCopyIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Row>
      <Row
        label="Backups"
        description={
          backups
            ? backups.count === 0
              ? `No backups yet. Backups are saved beside the database in ${backups.directory}.`
              : `${backups.count} backup${backups.count === 1 ? "" : "s"} · last one ${new Date(
                  backups.lastBackupAt!,
                ).toLocaleString()}. Saved beside the database as .bak files; the sandbox's Keep makes one too.`
            : "Loading…"
        }
      >
        <Button
          variant="contained"
          size="small"
          disableElevation
          startIcon={<BackupIcon />}
          onClick={backUpNow}
          disabled={backingUp || !!sandbox.status?.active}
          sx={{ fontWeight: 800, borderRadius: 2, whiteSpace: "nowrap" }}
        >
          {backingUp ? "Backing up…" : "Back up now"}
        </Button>
      </Row>
      <Row
        label="Sandbox"
        description={
          sandbox.status?.active
            ? `Active since ${new Date(sandbox.status.enteredAt!).toLocaleString()} — you are working on a copy. Keep or Discard it from the banner at the top.`
            : "Try changes on a copy of your data, then keep them or throw them away from the banner that appears at the top of every page. Your real data is untouched until you choose Keep."
        }
      >
        {sandbox.status?.active ? (
          <Chip label="Active" size="small" sx={{ bgcolor: "rgba(251,191,36,0.15)", color: "#fbbf24", fontWeight: 800 }} />
        ) : (
          <SandboxButton />
        )}
      </Row>
    </Section>
  );

  const sync = (
    <Section key="sync" title="Phone & sync" blurb={activeTab.blurb}>
      <Row
        label="Where this app runs"
        description={
          meta?.mode === "hosted"
            ? `Hosted server at ${apiOrigin()} — every device that opens this address shares the same data.`
            : "On this PC, with a local database. Nothing leaves your computer."
        }
      >
        <Chip label={modeLabel} size="small" sx={{ fontWeight: 800 }} />
      </Row>
      <Row
        label="Connection"
        description={
          connection.configured
            ? "Whether this device can reach the sync server right now. Checked every 30 seconds; click the dot to check again. The same status sits above Settings in the sidebar."
            : "No sync server is set up, so there is nothing to connect to and nothing to report. Once sync is configured, the status appears here and above Settings in the sidebar."
        }
      >
        {connection.configured ? (
          <ConnectionStatus status={connection} variant="settings" />
        ) : (
          <Chip label="Local only" size="small" variant="outlined" sx={{ fontWeight: 700 }} />
        )}
      </Row>
      <Row
        label="Sync across devices"
        description="Coming with the phone app: an Android app on the GitHub Releases page plus optional sync through a free database you own, so the phone and this PC stay in step. The options will appear here."
      >
        <Chip label="Not yet available" size="small" variant="outlined" sx={{ fontWeight: 700 }} />
      </Row>
    </Section>
  );

  // Each section carries its tab as `key`: without it React reuses the row
  // elements across tabs (same component types at the same positions), and
  // a button that changes variant - "Back up now" (contained) becoming "Open
  // Income" (outlined) - animates between the two for a moment.
  const sections: Record<SettingsTab, React.ReactNode> = { general, budget, data, sync };

  const toastEl = (
    <Snackbar
      open={toastOpen}
      autoHideDuration={4000}
      onClose={() => setToastOpen(false)}
      message={toastMsg}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      slots={{ transition: Fade }}
      slotProps={{ transition: { onExited: () => setToastMsg("") } as any }}
    />
  );

  // ── Popup form (desktop) ──
  // Discord's layout: the tab column flush against the left edge, the open
  // section filling the rest, the close button in the top-right corner. No
  // hero header and no outer margins — the window edge is the frame.
  if (onClose) {
    return (
      <>
        <Box
          sx={{
            width: 240,
            flexShrink: 0,
            bgcolor: "rgba(15, 23, 42, 0.6)",
            borderRight: "1px solid rgba(255,255,255,0.06)",
            p: 2,
            pt: 3,
            overflowY: "auto",
          }}
        >
          <Typography
            id="settings-dialog-title"
            sx={{
              px: 1.5,
              pb: 1,
              fontSize: "0.72rem",
              fontWeight: 900,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              color: "text.secondary",
            }}
          >
            Settings
          </Typography>
          <TabNav active={active} onSelect={selectTab} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, overflowY: "auto", position: "relative", px: 5, py: 4 }}>
          <Tooltip title="Close (Esc)">
            <IconButton
              onClick={onClose}
              aria-label="Close settings"
              sx={{
                position: "absolute",
                top: 20,
                right: 24,
                color: "#94a3b8",
                border: "1px solid rgba(255,255,255,0.1)",
                "&:hover": { color: "white", bgcolor: "rgba(129, 140, 248, 0.12)" },
              }}
            >
              <CloseIcon />
            </IconButton>
          </Tooltip>
          {/* Rows span the whole column (label left, control right); only the
              close button's corner is kept clear. */}
          <Box sx={{ pr: 7 }}>{sections[active]}</Box>
        </Box>
        {toastEl}
      </>
    );
  }

  // ── Page form (below the sider breakpoint) ──
  return (
    <Box
      sx={{
        p: { xs: 2, md: 4 },
        display: "flex",
        flexDirection: "column",
        gap: 3,
        maxWidth: 1100,
        mx: "auto",
        width: "100%",
      }}
    >
      {/* ── Title ── */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <Box
          sx={{
            display: "flex",
            p: 1,
            borderRadius: 2,
            bgcolor: "primary.main",
            boxShadow: "0 0 20px rgba(129, 140, 248, 0.4)",
            flexShrink: 0,
          }}
        >
          <SettingsIcon sx={{ color: "white", fontSize: "1.8rem" }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="h4"
            sx={{ fontWeight: 900, letterSpacing: "-1px", color: "white", fontSize: { xs: "1.6rem", sm: "2.125rem" } }}
          >
            Settings
          </Typography>
          <Typography sx={{ color: "text.secondary", fontSize: "0.9rem" }}>
            App, budget, data and sync options.
          </Typography>
        </Box>
      </Box>

      {/* ── Tabs + the open section ──
          One panel: the tab strip on a slightly darker ground, the open
          section below it. */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "220px minmax(0, 1fr)" },
          alignItems: "stretch",
          bgcolor: "rgba(30, 41, 59, 0.45)",
          border: "1px solid rgba(129, 140, 248, 0.15)",
          borderRadius: 3,
          overflow: "hidden",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.25)",
        }}
      >
        <Box
          sx={{
            p: { xs: 1.5, md: 2 },
            bgcolor: "rgba(15, 23, 42, 0.5)",
            borderRight: { md: "1px solid rgba(255,255,255,0.06)" },
            borderBottom: { xs: "1px solid rgba(255,255,255,0.06)", md: "none" },
          }}
        >
          <TabNav active={active} onSelect={selectTab} />
        </Box>
        <Box sx={{ p: { xs: 2, md: 4 }, minWidth: 0, minHeight: { md: 420 } }}>{sections[active]}</Box>
      </Box>

      {toastEl}
    </Box>
  );
};
