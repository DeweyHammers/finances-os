"use client";

/**
 * SettingsPage — the Settings content, laid out like Obsidian's and Discord's
 * settings: a narrow nav of tabs on the left, ONE section at a time on the
 * right as a panel of rows (label + explanation left, control right). On a
 * desktop-width window it is shown inside SettingsDialog (a popup, with the
 * close button); below the sider breakpoint it is the /Settings page (see
 * SettingsDialogContext for the rule).
 *
 *  general  — version + "Check for updates" → Download → Restart to update
 *             (main/updates.ts; link-only outside the installed app), help,
 *             issues
 *  budget   — surplus target (the ONLY place it is edited; the Overview pill
 *             is read-only and opens this tab), link to the Income page
 *  data     — where the database is, backups ("Back up now" → .bak beside it
 *             via /api/backups), the "Try a sandbox" entry point
 *  sync     — run mode, then SyncSection.tsx: Local only / Synced, the
 *             cloud URL + token and Connect, Sync now, Forget this device,
 *             Export / Import (plans/phone-app-and-sync.md Phase B)
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
  Fade,
  IconButton,
  InputAdornment,
  LinearProgress,
  Snackbar,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import DownloadIcon from "@mui/icons-material/Download";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
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
  fetchUpdateStatus,
  loadBackups,
  loadMeta,
  MODE_LABELS,
  runUpdateAction,
  type AppMeta,
  type BackupInfo,
  type UpdateStatus,
} from "../../lib/meta-api";
import { useSandbox } from "../sandbox/SandboxContext";
import { SandboxButton } from "../sandbox/SandboxButton";
import { takeSettingsToast, type SettingsTab } from "./SettingsDialogContext";
import { Row, Section } from "./SettingsRows";
import { SyncSection } from "./SyncSection";

// ── Tabs ────────────────────────────────────────────────────────────────────

const TABS: { id: SettingsTab; label: string; blurb: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", blurb: "Version, updates and help.", icon: <TuneIcon /> },
  { id: "budget", label: "Budget", blurb: "The numbers the plan is built around.", icon: <SavingsIcon /> },
  { id: "data", label: "Data", blurb: "Where your data lives, backups and the sandbox.", icon: <StorageIcon /> },
  { id: "sync", label: "Phone & sync", blurb: "Keep this PC and your other devices in step through a cloud database you own.", icon: <SyncIcon /> },
];

// ── Layout helpers ──────────────────────────────────────────────────────────
// Section / Row live in SettingsRows.tsx (shared with SyncSection.tsx).

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

/** A status before the first answer arrives — used to show "Checking…" at once. */
const emptyUpdateStatus: UpdateStatus = {
  supported: false,
  installBlocked: null,
  state: "idle",
  current: "",
  latest: null,
  releaseDate: null,
  releaseUrl: "#",
  progress: null,
  error: null,
  checkedAt: null,
};

/** Human names for `AppMeta.platform` (Node's process.platform, or Capacitor's). */
const PLATFORM_LABELS: Record<string, string> = {
  win32: "Windows",
  darwin: "macOS",
  linux: "Linux",
  android: "Android",
  web: "Browser",
};

/** "51 MB of 123 MB" for the download row. */
const formatBytes = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} MB` : `${Math.round(n / 1e3)} KB`);

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

  // In-app updates (main/updates.ts). `update` is the server's status, the
  // one thing the row renders from: Check → "Version X is available" with
  // Download → progress → "Restart to update". Fetched once on open (a
  // silent startup check or a download in progress shows right away — no
  // cached first render on purpose: the sibling rows hydrate from null
  // too), then polled every 500 ms while the server is busy.
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  // The click's own failure (a 409, the API being away) — separate from the
  // status's `error`, which is the engine's.
  const [updateActionError, setUpdateActionError] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchUpdateStatus(ctrl.signal).then(setUpdate).catch(() => {});
    return () => ctrl.abort();
  }, []);
  const updatePolling = update?.state === "checking" || update?.state === "downloading" || update?.state === "installing";
  useEffect(() => {
    if (!updatePolling) return;
    const ctrl = new AbortController();
    const t = setInterval(() => {
      fetchUpdateStatus(ctrl.signal).then(setUpdate).catch(() => {});
    }, 500);
    return () => {
      clearInterval(t);
      ctrl.abort();
    };
  }, [updatePolling]);
  const runUpdate = async (action: "check" | "download" | "install") => {
    setUpdateBusy(true);
    setUpdateActionError(null);
    // Show the transition at once; the server's answer replaces it.
    if (action === "check") setUpdate((u) => ({ ...(u ?? emptyUpdateStatus), state: "checking" }));
    try {
      setUpdate(await runUpdateAction(action));
    } catch (e: any) {
      setUpdateActionError(e.message);
      // Re-read where the server really is after a refused call.
      fetchUpdateStatus().then(setUpdate).catch(() => {});
    } finally {
      setUpdateBusy(false);
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
  // A sync action that reloaded the window (Import, Connect taking the
  // cloud's data) left its result message for us to show now.
  useEffect(() => {
    const pending = takeSettingsToast();
    if (pending) toast(pending);
  }, []);
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

  const modeLabel = meta ? MODE_LABELS[meta.mode] : "…";
  const onThisPc = meta?.mode !== "hosted" && meta?.mode !== "android";
  // The Android app (Phase C): local database on the phone, no server. The
  // desktop-only features — sandbox, backups, export/import, sync — are not
  // there yet; their rows say so instead of showing a button that can only
  // fail. Keyed off the mode the API reports, not off the platform itself
  // (lib/platform.ts is read in exactly two places).
  const onPhone = meta?.mode === "android";

  // ── Sections ──

  // The second row of General: what the last check found and the next step.
  // One row, its label/description/control chosen by the update state; it
  // is absent until there is something to say (idle, or a status that
  // hasn't loaded yet). The manual Release-page link is the fallback for a
  // build that can't install itself (dev / hosted), and the way out of a
  // failed download.
  const updateRow = (() => {
    if (updateActionError) {
      return (
        <Row label="Update failed" description={updateActionError}>
          {update?.latest && (
            <Button {...linkButton} href={update.releaseUrl} component="a">
              Release page
            </Button>
          )}
        </Row>
      );
    }
    if (!update || update.state === "idle" || update.state === "checking") return null;
    const contained = {
      variant: "contained" as const,
      size: "small" as const,
      disableElevation: true,
      sx: { fontWeight: 800, borderRadius: 2, whiteSpace: "nowrap" },
    };
    switch (update.state) {
      case "up-to-date":
        return <Row label="You're up to date" description={`Latest release is ${update.latest}.`} />;
      case "available":
        // The installed app, but this PC refuses app-started installers
        // (Smart App Control, Oct 29 2026): say why, link the Release page,
        // and never offer a Download that would end in the app quitting.
        if (update.installBlocked) {
          return (
            <Row label={`Version ${update.latest} is available`} description={update.installBlocked.message}>
              <Button {...linkButton} href={update.releaseUrl} component="a">
                Release page
              </Button>
            </Row>
          );
        }
        return update.supported ? (
          <Row
            label={`Version ${update.latest} is available`}
            description="Download it now; the app restarts to install when you're ready. Your data stays where it is."
          >
            <Button {...linkButton} href={update.releaseUrl} component="a">
              What's new
            </Button>
            <Button {...contained} startIcon={<DownloadIcon />} onClick={() => runUpdate("download")} disabled={updateBusy}>
              Download
            </Button>
          </Row>
        ) : (
          <Row
            label={`Version ${update.latest} is available`}
            description={
              onPhone
                ? "Download the new APK from the Release page and install it over this app; your data stays on the phone."
                : "Download the new installer from the Release page and run it; your data stays where it is."
            }
          >
            <Button {...linkButton} href={update.releaseUrl} component="a">
              Download
            </Button>
          </Row>
        );
      case "downloading": {
        const p = update.progress;
        const pct = p ? Math.round(p.percent) : 0;
        return (
          <Row
            label={`Downloading version ${update.latest}…`}
            description={
              <Box component="span" sx={{ display: "block" }}>
                {p && p.total > 0 ? `${pct}% · ${formatBytes(p.transferred)} of ${formatBytes(p.total)}` : "Starting…"}
                <LinearProgress
                  variant={p && p.total > 0 ? "determinate" : "indeterminate"}
                  value={pct}
                  sx={{ mt: 1, borderRadius: 1, height: 6, maxWidth: 420 }}
                />
              </Box>
            }
          />
        );
      }
      case "downloaded":
      case "installing":
        return (
          <Row
            label={`Version ${update.latest} is ready to install`}
            description="The app closes, installs the update and opens again. Your data stays where it is."
          >
            <Button
              {...contained}
              startIcon={<RestartAltIcon />}
              onClick={() => runUpdate("install")}
              disabled={updateBusy || update.state === "installing"}
            >
              {update.state === "installing" ? "Restarting…" : "Restart to update"}
            </Button>
          </Row>
        );
      case "error":
        return (
          <Row label={update.latest ? "Update failed" : "Update check failed"} description={update.error ?? "Unknown error"}>
            {update.latest && (
              <Button {...linkButton} href={update.releaseUrl} component="a">
                Release page
              </Button>
            )}
          </Row>
        );
      default:
        return null;
    }
  })();

  const general = (
    <Section key="general" title="General" blurb={activeTab.blurb}>
      <Row
        label={meta ? `Version ${meta.version}` : "Version"}
        description={
          metaError
            ? `Could not read app info: ${metaError}`
            : meta
              ? `${modeLabel} · ${PLATFORM_LABELS[meta.platform] ?? meta.platform}`
              : "Loading…"
        }
      >
        <Button
          variant="contained"
          size="small"
          disableElevation
          startIcon={<SystemUpdateAltIcon />}
          onClick={() => runUpdate("check")}
          // A download or a finished download is left alone: checking again
          // would only re-answer the same release.
          disabled={updateBusy || updatePolling || update?.state === "downloaded"}
          sx={{ fontWeight: 800, borderRadius: 2, whiteSpace: "nowrap" }}
        >
          {update?.state === "checking" ? "Checking…" : "Check for updates"}
        </Button>
      </Row>
      {updateRow}
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
              {onPhone
                ? "Your data lives on this phone, in this app's private storage; nothing leaves the phone. "
                : onThisPc
                  ? "Your data lives in this file on this PC. "
                  : "Your data lives on the server. "}
              <Box component="code" sx={{ fontSize: "0.78rem", color: "#cbd5e1" }}>
                {meta.databasePath}
              </Box>
            </>
          ) : (
            "Loading…"
          )
        }
      >
        {!onPhone && (
          <Tooltip title="Copy path">
            <span>
              <IconButton size="small" onClick={() => meta && copy(meta.databasePath)} disabled={!meta}>
                <ContentCopyIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Row>
      <Row
        label="Backups"
        description={
          onPhone
            ? "Not on the phone yet. Backups, export and import arrive together with phone sync in a later version; until then uninstalling the app deletes its data, so keep the app installed."
            : backups
              ? backups.count === 0
                ? `No backups yet. Backups are saved beside the database in ${backups.directory}.`
                : `${backups.count} backup${backups.count === 1 ? "" : "s"} · last one ${new Date(
                    backups.lastBackupAt!,
                  ).toLocaleString()}. Saved beside the database as .bak files; the sandbox's Keep makes one too.`
              : "Loading…"
        }
      >
        {!onPhone && (
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
        )}
      </Row>
      <Row
        label="Sandbox"
        description={
          onPhone
            ? "The sandbox is a desktop feature: on the PC it lets you try changes on a copy of your data. It isn't on the phone yet."
            : sandbox.status?.active
              ? `Active since ${new Date(sandbox.status.enteredAt!).toLocaleString()} — you are working on a copy. Keep or Discard it from the banner at the top.`
              : "Try changes on a copy of your data, then keep them or throw them away from the banner that appears at the top of every page. Your real data is untouched until you choose Keep."
        }
      >
        {onPhone ? null : sandbox.status?.active ? (
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
            : onPhone
              ? "On this phone, with a local database in the app's own storage."
              : "On this PC, with a local database file."
        }
      >
        <Chip label={modeLabel} size="small" sx={{ fontWeight: 800 }} />
      </Row>
      {onPhone ? (
        // Phase D (plans/phone-app-and-sync.md) brings sync, export and import
        // to the phone; until then the one honest row instead of controls
        // that would only be refused.
        <Row
          label="Sync"
          description="Keeping this phone and your PC in step through a cloud database you own is the next step on the roadmap. Until then your data stays on this phone, and export / import arrive together with it."
        >
          <Chip label="Local only" size="small" variant="outlined" sx={{ fontWeight: 800 }} />
        </Row>
      ) : (
        <SyncSection docsUrl={meta?.docsUrl} toast={toast} />
      )}
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
