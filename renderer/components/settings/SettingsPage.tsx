"use client";

/**
 * SettingsPage — /Settings, laid out like Obsidian's settings: titled
 * sections, each a card of rows with the label + explanation on the left and
 * the control on the right.
 *
 *  General  — version + "Check for updates" (GitHub Releases), help, issues
 *  Budget   — surplus target (same AppSettings column the Overview pill edits),
 *             link to the Income page (pay schedule lives there)
 *  Data     — where the database is, backups ("Back up now" → .bak beside
 *             it via /api/backups), sandbox state
 *  Sync     — run mode, the connection indicator, and what sync will be
 *             (plans/phone-app-and-sync.md): no controls until it exists
 *
 * Non-resource calls go through lib/meta-api.ts; the surplus target goes
 * through Refine like everywhere else.
 */

import { useEffect, useState } from "react";
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
import ScienceIcon from "@mui/icons-material/Science";
import SettingsIcon from "@mui/icons-material/Settings";
import { useOne, useUpdate } from "@refinedev/core";
import { useRouter } from "next/navigation";
import { fromCents, toCents } from "../../lib/cents";
import {
  apiOrigin,
  createBackup,
  fetchBackups,
  fetchMeta,
  fetchUpdateCheck,
  MODE_LABELS,
  type AppMeta,
  type BackupInfo,
  type UpdateCheck,
} from "../../lib/meta-api";
import { useConnectionStatus } from "../../lib/use-connection-status";
import { useSandbox } from "../sandbox/SandboxContext";
import { ConnectionStatus } from "../layout/ConnectionStatus";

// ── Layout helpers ──────────────────────────────────────────────────────────

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Box>
    <Typography
      sx={{
        px: 1,
        pb: 1,
        fontSize: "0.72rem",
        fontWeight: 900,
        letterSpacing: 1.5,
        textTransform: "uppercase",
        color: "text.secondary",
      }}
    >
      {title}
    </Typography>
    <Box
      sx={{
        bgcolor: "rgba(30, 41, 59, 0.55)",
        border: "1px solid rgba(129, 140, 248, 0.15)",
        borderRadius: 3,
        px: { xs: 2, sm: 3 },
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

const linkButton = {
  variant: "outlined" as const,
  size: "small" as const,
  endIcon: <OpenInNewIcon sx={{ fontSize: "14px !important" }} />,
  sx: { fontWeight: 700, borderRadius: 2, whiteSpace: "nowrap" },
  target: "_blank",
  rel: "noreferrer",
};

// ── Page ────────────────────────────────────────────────────────────────────

export const SettingsPage = () => {
  const router = useRouter();

  // App facts
  const [meta, setMeta] = useState<AppMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  useEffect(() => {
    fetchMeta().then(setMeta).catch((e) => setMetaError(e.message));
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

  // Surplus target — same column as SurplusTargetPill on the Overview.
  const { query: settingsQuery } = useOne({
    resource: "AppSettings",
    id: "global",
    successNotification: false,
    errorNotification: false,
  });
  const { mutate: updateSettings } = useUpdate();
  const remoteCents = Number((settingsQuery.data?.data as any)?.wifeWeeklyTargetCents ?? 30000);
  const [surplusDraft, setSurplusDraft] = useState<string | null>(null);
  const surplusValue = surplusDraft ?? String(fromCents(remoteCents));
  const surplusDirty = surplusDraft !== null && toCents(surplusDraft) !== remoteCents;
  const saveSurplus = () => {
    if (!surplusDirty) return;
    updateSettings({
      resource: "AppSettings",
      id: "global",
      values: { wifeWeeklyTargetCents: toCents(surplusValue) },
      successNotification: false,
    });
    setSurplusDraft(null);
  };

  // Backups
  const [backups, setBackups] = useState<BackupInfo | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  useEffect(() => {
    fetchBackups().then(setBackups).catch(() => {});
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

  return (
    <Box
      sx={{
        p: { xs: 2, md: 4 },
        display: "flex",
        flexDirection: "column",
        gap: 4,
        maxWidth: 960,
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
        <Box>
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

      {/* ── General ── */}
      <Section title="General">
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

      {/* ── Budget ── */}
      <Section title="Budget">
        <Row
          label="Surplus target"
          description="The minimum each pay week must clear after bills and personal spending. Optimize plans bill splits around it. Also editable from the Overview toolbar."
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
            onClick={() => router.push("/Income")}
            sx={{ fontWeight: 700, borderRadius: 2, whiteSpace: "nowrap" }}
          >
            Open Income
          </Button>
        </Row>
      </Section>

      {/* ── Data ── */}
      <Section title="Data">
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
              : "Try changes on a copy of your data and throw them away or keep them. Start one from the Overview toolbar."
          }
        >
          {sandbox.status?.active ? (
            <Chip label="Active" size="small" sx={{ bgcolor: "rgba(251,191,36,0.15)", color: "#fbbf24", fontWeight: 800 }} />
          ) : (
            <Button
              variant="outlined"
              size="small"
              startIcon={<ScienceIcon />}
              onClick={() => router.push("/Overview")}
              sx={{ fontWeight: 700, borderRadius: 2, whiteSpace: "nowrap" }}
            >
              Open Overview
            </Button>
          )}
        </Row>
      </Section>

      {/* ── Sync ── */}
      <Section title="Phone & sync">
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
          description="Whether this screen can reach the database right now. Checked every 30 seconds; click the indicator to check again."
        >
          <ConnectionStatus status={connection} variant="settings" />
        </Row>
        <Row
          label="Sync across devices"
          description="Coming with the phone app: an Android app on the GitHub Releases page plus optional sync through a free database you own, so the phone and this PC stay in step. The options will appear here."
        >
          <Chip label="Not yet available" size="small" variant="outlined" sx={{ fontWeight: 700 }} />
        </Row>
      </Section>

      <Snackbar
        open={toastOpen}
        autoHideDuration={4000}
        onClose={() => setToastOpen(false)}
        message={toastMsg}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        slots={{ transition: Fade }}
        slotProps={{ transition: { onExited: () => setToastMsg("") } as any }}
      />
    </Box>
  );
};
