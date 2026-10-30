"use client";

/**
 * SyncSection — Settings → Phone & sync (Phase B of
 * plans/phone-app-and-sync.md).
 *
 *   Local only (default)  URL + token fields and Connect. Connecting uploads
 *                         this PC's data into the cloud database; when the
 *                         cloud already holds data a dialog asks which side
 *                         wins (the choice is deliberate, never silent).
 *   Synced                the status row (shared with the sider), Sync now,
 *                         and "Forget this device" (confirmed): back to local
 *                         only, the data stays here, the token is removed.
 *                         Since Oct 29 2026 changes are saved on this PC
 *                         first and pushed in the background, so a Conflict
 *                         row appears when the cloud changed while this PC
 *                         had unpushed changes: "Use the cloud's copy" or
 *                         "Keep this PC's changes", each confirmed, each
 *                         with a .bak of the side that loses.
 *   Both                  Export (a plain SQLite download) and Import (a file
 *                         picker; confirmed, a backup is written first).
 *
 * Only the actions that CHANGE what the API serves reload the window (like
 * the sandbox does): Connect taking the cloud's data, and Import. Settings
 * reopens on this tab after the reload. Uploading this PC's data and Forget
 * keep the same rows, so they just update the status and Settings stays
 * open (user feedback, Oct 28 2026). The token is sent once and never shown
 * again.
 */
import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  InputAdornment,
  TextField,
} from "@mui/material";
import CloudSyncIcon from "@mui/icons-material/CloudSync";
import SyncIcon from "@mui/icons-material/Sync";
import CloudOffIcon from "@mui/icons-material/CloudOff";
import DownloadIcon from "@mui/icons-material/Download";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useConnectionStatus } from "../../lib/use-connection-status";
import {
  connectSync,
  disconnectSync,
  downloadExport,
  resolveConflict,
  uploadImport,
  SyncApiError,
  type RemoteFacts,
} from "../../lib/sync-api";
import { useSandbox } from "../sandbox/SandboxContext";
import { ConnectionStatus } from "../layout/ConnectionStatus";
import { Row } from "./SettingsRows";
import { reopenSettingsAfterReload } from "./SettingsDialogContext";

interface SyncSectionProps {
  /** The docs site, for the "Set up sync" guide link. */
  docsUrl?: string;
  toast: (message: string) => void;
}

const button = { size: "small" as const, sx: { fontWeight: 800, borderRadius: 2, whiteSpace: "nowrap" } };

export const SyncSection = ({ docsUrl, toast }: SyncSectionProps) => {
  const connection = useConnectionStatus();
  const sandbox = useSandbox();
  const status = connection.status;
  const sandboxActive = !!sandbox.status?.active;

  // ── Connect ──
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState<null | "connect" | "sync" | "forget" | "export" | "import" | "resolve">(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  /** The cloud already holds data: ask which side wins. */
  const [remoteHasData, setRemoteHasData] = useState<RemoteFacts | null>(null);

  const connect = async (source?: "local" | "cloud") => {
    setBusy("connect");
    setConnectError(null);
    setRemoteHasData(null);
    try {
      const next = await connectSync(url.trim(), token.trim(), source);
      connection.apply(next);
      setToken("");
      if (source === "cloud") {
        // This PC now shows the cloud's data instead of its own: every
        // Refine cache must start over, so reload (and come back here).
        reopenSettingsAfterReload("sync", "Synced. This PC now shows your cloud database's data.");
        window.location.reload();
      } else {
        // The data is the same rows, now also in the cloud: nothing to reload.
        toast("Synced. This PC's data is in your cloud database.");
      }
    } catch (e: any) {
      if (e instanceof SyncApiError && e.code === "REMOTE_HAS_DATA") {
        setRemoteHasData(e.details as RemoteFacts);
      } else {
        setConnectError(e?.message || String(e));
      }
    } finally {
      setBusy(null);
    }
  };

  // ── Sync now / Forget ──
  const syncNowClick = async () => {
    setBusy("sync");
    try {
      await connection.syncNow();
    } finally {
      setBusy(null);
    }
  };

  const [confirmForget, setConfirmForget] = useState(false);
  const forget = async () => {
    setConfirmForget(false);
    setBusy("forget");
    try {
      const next = await disconnectSync();
      connection.apply(next);
      // Same rows, now in the local file: no reload needed, Settings stays open.
      toast("This device is local only again. Your data stayed on this PC.");
    } catch (e: any) {
      toast(`Could not forget this device: ${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  };

  // ── Conflict ──
  const [confirmResolve, setConfirmResolve] = useState<null | "cloud" | "local">(null);
  const resolve = async () => {
    const keep = confirmResolve;
    setConfirmResolve(null);
    if (!keep) return;
    setBusy("resolve");
    try {
      const next = await resolveConflict(keep);
      if (keep === "cloud") {
        // This PC now shows the cloud's data instead of its own: every Refine
        // cache must start over, so reload (and come back here).
        reopenSettingsAfterReload(
          "sync",
          "Settled: this PC now shows your cloud database's data. The changes it had are in a backup beside the database.",
        );
        window.location.reload();
      } else {
        connection.apply(next);
        toast("Settled: your cloud database now holds this PC's data. The cloud's previous rows are in a backup beside the database.");
      }
    } catch (e: any) {
      toast(`Could not settle the conflict: ${e?.message || e}`);
    } finally {
      if (keep !== "cloud") setBusy(null);
    }
  };

  // ── Export / Import ──
  const exportClick = async () => {
    setBusy("export");
    try {
      const name = await downloadExport();
      toast(`Exported ${name}`);
    } catch (e: any) {
      toast(`Export failed: ${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  };

  const fileInput = useRef<HTMLInputElement | null>(null);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const importFile = async () => {
    const file = pendingImport;
    setPendingImport(null);
    if (!file) return;
    setBusy("import");
    try {
      const r = await uploadImport(file);
      reopenSettingsAfterReload(
        "sync",
        `Imported ${r.dataRows} rows from ${file.name}${r.target === "cloud" ? " into your cloud database" : ""}. A backup of the previous data was saved beside the database.`,
      );
      window.location.reload();
    } catch (e: any) {
      toast(`Import failed: ${e?.message || e}`);
      setBusy(null);
    }
  };

  const guideHref = docsUrl ? `${docsUrl.replace(/\/?$/, "/")}sync.html` : undefined;
  const configured = !!status?.configured;
  const pending = status?.pendingChanges ?? 0;
  const pendingText = pending === 1 ? "1 change" : `${pending} changes`;
  const conflict = !!status?.conflict;

  return (
    <>
      <Row
        label="Sync"
        description={
          configured ? (
            <>
              Changes are saved on this PC at once and sent to your cloud database within a few seconds; other devices
              pick them up on their next sync. Cloud database:{" "}
              <code style={{ fontSize: "0.78rem", color: "#cbd5e1" }}>{status?.url}</code>
              {status?.replicaPath ? (
                <>
                  {" "}
                  · local copy at <code style={{ fontSize: "0.78rem", color: "#cbd5e1" }}>{status.replicaPath}</code>
                </>
              ) : null}
            </>
          ) : (
            "Local only. Your data stays in the database file on this PC. To use it on your phone and keep devices in step, connect a free cloud database you own."
          )
        }
      >
        <Chip
          label={!configured ? "Local only" : conflict ? "Conflict" : status?.state === "offline" ? "Offline" : "Synced"}
          size="small"
          variant={configured ? "filled" : "outlined"}
          sx={{
            fontWeight: 800,
            ...(configured
              ? conflict
                ? { bgcolor: "rgba(244,63,94,0.15)", color: "#f43f5e" }
                : status?.state === "offline"
                  ? { bgcolor: "rgba(251,191,36,0.15)", color: "#fbbf24" }
                  : { bgcolor: "rgba(61,188,131,0.15)", color: "#3DBC83" }
              : {}),
          }}
        />
      </Row>

      {status?.writesBlocked && (
        <Alert severity={status.state === "blocked" ? "error" : "warning"} sx={{ my: 1.5, borderRadius: 2 }}>
          {status.writesBlocked}
        </Alert>
      )}

      {/* The cloud changed while this PC had unpushed changes: the user picks a side, nothing is merged. */}
      {configured && conflict && (
        <>
          <Alert severity="error" sx={{ my: 1.5, borderRadius: 2 }} data-testid="sync-conflict">
            Your cloud database was changed from another device while this PC had {pending > 0 ? pendingText : "changes"}{" "}
            that had not reached it yet. The two can&apos;t be combined automatically. Choose which side to keep; the other
            side is saved as a backup beside the database first. Until you choose, this PC keeps working on its own copy
            and nothing is sent to the cloud.
          </Alert>
          <Row
            label="Settle the conflict"
            description="Use the cloud's copy: this PC takes the cloud's data (its own unsent changes go into a backup). Keep this PC's changes: the cloud is replaced with this PC's data (the cloud's rows go into a backup) and every other device gets it on its next sync."
          >
            <Button
              {...button}
              variant="contained"
              disableElevation
              onClick={() => setConfirmResolve("cloud")}
              disabled={busy !== null || sandboxActive}
            >
              {busy === "resolve" ? "Settling…" : "Use the cloud's copy"}
            </Button>
            <Button
              {...button}
              variant="outlined"
              color="warning"
              onClick={() => setConfirmResolve("local")}
              disabled={busy !== null || sandboxActive}
            >
              Keep this PC&apos;s changes
            </Button>
          </Row>
        </>
      )}

      {!configured && (
        <Row
          label="Connect a cloud database"
          description={
            <>
              Create a free database at Turso, copy its URL and a token, and paste them here. This PC&apos;s data is
              uploaded to it once; the token is stored encrypted on this PC and never inside the database.
              {guideHref && (
                <>
                  {" "}
                  <a href={guideHref} target="_blank" rel="noreferrer" style={{ color: "#818cf8" }}>
                    Step-by-step guide <OpenInNewIcon sx={{ fontSize: 12, verticalAlign: "middle" }} />
                  </a>
                </>
              )}
            </>
          }
        >
          <TextField
            size="small"
            label="Database URL"
            placeholder="libsql://your-db-name.turso.io"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy !== null || sandboxActive}
            slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "none", "data-testid": "sync-url" } }}
            sx={{ width: { xs: "100%", sm: 280 } }}
          />
          <TextField
            size="small"
            label="Token"
            type={showToken ? "text" : "password"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={busy !== null || sandboxActive}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url && token) connect();
            }}
            slotProps={{
              htmlInput: { spellCheck: false, autoCapitalize: "none", "data-testid": "sync-token" },
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setShowToken((s) => !s)} aria-label={showToken ? "Hide token" : "Show token"}>
                      {showToken ? <VisibilityOffIcon sx={{ fontSize: 18 }} /> : <VisibilityIcon sx={{ fontSize: 18 }} />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
            sx={{ width: { xs: "100%", sm: 220 } }}
          />
          <Button
            {...button}
            variant="contained"
            disableElevation
            startIcon={<CloudSyncIcon />}
            onClick={() => connect()}
            disabled={busy !== null || !url.trim() || !token.trim() || sandboxActive}
          >
            {busy === "connect" ? "Connecting…" : "Connect"}
          </Button>
        </Row>
      )}
      {/* Outside the Row: its description is a <p>, and an Alert is a <div>. */}
      {!configured && connectError && (
        <Alert severity="error" sx={{ my: 1.5, borderRadius: 2 }} onClose={() => setConnectError(null)}>
          {connectError}
        </Alert>
      )}

      {configured && (
        <>
          <Row
            label="Connection"
            description={
              <>
                Changes are sent a few seconds after you make them and the cloud is checked every minute; click the dot
                or Sync now to do both right away. The same status sits at the bottom of the sidebar.
                {status?.state === "offline" && pending > 0 ? ` ${pendingText} waiting to be sent.` : ""}
              </>
            }
          >
            <ConnectionStatus variant="settings" />
            <Button
              {...button}
              variant="outlined"
              startIcon={<SyncIcon />}
              onClick={syncNowClick}
              disabled={busy !== null || status?.state === "paused" || status?.state === "blocked" || conflict}
            >
              {busy === "sync" || status?.syncing ? "Syncing…" : "Sync now"}
            </Button>
          </Row>
          <Row
            label="This device"
            description={
              <>
                Forgetting this device stops syncing on this PC and removes the cloud token from it. Your data stays here
                as a local copy (a backup of the previous local file is saved first); the cloud database is untouched.
                {pending > 0 ? ` ${pendingText} on this PC never reached the cloud and would stay here only.` : ""}
              </>
            }
          >
            <Button
              {...button}
              variant="outlined"
              color="warning"
              startIcon={<CloudOffIcon />}
              onClick={() => setConfirmForget(true)}
              disabled={busy !== null || sandboxActive}
            >
              Forget this device
            </Button>
          </Row>
        </>
      )}

      <Row
        label="Export database"
        description="Save a copy of all your data as a plain SQLite file — to keep, to move to another PC, or to open in any SQLite tool. Works the same whether or not sync is on."
      >
        <Button {...button} variant="outlined" startIcon={<DownloadIcon />} onClick={exportClick} disabled={busy !== null || sandboxActive}>
          {busy === "export" ? "Exporting…" : "Export"}
        </Button>
      </Row>
      <Row
        label="Import database"
        description={
          configured
            ? "Replace your data with an exported file (or a .bak). It goes to the cloud database, so every synced device gets it. A backup of the current data is saved first."
            : "Replace your data with an exported file (or a .bak). A backup of the current data is saved first."
        }
      >
        <input
          ref={fileInput}
          type="file"
          accept=".db,.bak,.sqlite,.sqlite3,application/octet-stream"
          hidden
          data-testid="sync-import-file"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (file) setPendingImport(file);
          }}
        />
        <Button
          {...button}
          variant="outlined"
          startIcon={<UploadFileIcon />}
          onClick={() => fileInput.current?.click()}
          disabled={busy !== null || sandboxActive || status?.state === "blocked"}
        >
          {busy === "import" ? "Importing…" : "Import…"}
        </Button>
      </Row>

      {/* The cloud database already holds data: which side wins? */}
      <Dialog open={!!remoteHasData} onClose={() => setRemoteHasData(null)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>This cloud database already has data</DialogTitle>
        <DialogContent>
          <DialogContentText>
            It holds {remoteHasData?.dataRows ?? 0} rows — probably from another device. Which data should this PC
            use from now on? The other side is replaced; a backup of this PC&apos;s file stays on disk either way.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setRemoteHasData(null)}>Cancel</Button>
          <Button variant="outlined" onClick={() => connect("local")} sx={{ fontWeight: 700 }}>
            Replace the cloud with this PC&apos;s data
          </Button>
          <Button variant="contained" disableElevation onClick={() => connect("cloud")} sx={{ fontWeight: 800 }}>
            Use the cloud data on this PC
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmForget} onClose={() => setConfirmForget(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 800 }}>Forget this device?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Sync stops on this PC and the cloud token is removed from it. The data you see now stays here as a local
            copy; nothing in the cloud changes. You can connect again any time.
            {pending > 0
              ? ` ${pendingText} made here never reached the cloud; they stay on this PC only.`
              : ""}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmForget(false)}>Cancel</Button>
          <Button variant="contained" color="warning" disableElevation onClick={forget} sx={{ fontWeight: 800 }}>
            Forget this device
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!confirmResolve} onClose={() => setConfirmResolve(null)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>
          {confirmResolve === "cloud" ? "Use the cloud's copy on this PC?" : "Replace the cloud with this PC's data?"}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirmResolve === "cloud"
              ? `This PC fetches your cloud database again and shows its data. The ${pending > 0 ? pendingText : "changes"} made here that never reached the cloud are not sent; they are saved as a backup beside the database first, so nothing is lost.`
              : "The cloud database's rows are replaced with this PC's data, and every other device takes it on its next sync. What the cloud holds now is saved as a backup beside the database first, so nothing is lost."}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmResolve(null)}>Cancel</Button>
          <Button
            variant="contained"
            color={confirmResolve === "cloud" ? "primary" : "warning"}
            disableElevation
            onClick={resolve}
            sx={{ fontWeight: 800 }}
          >
            {confirmResolve === "cloud" ? "Use the cloud's copy" : "Keep this PC's changes"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!pendingImport} onClose={() => setPendingImport(null)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 800 }}>Import {pendingImport?.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Everything in the app is replaced by the file&apos;s data
            {configured ? ", in the cloud database too, so every synced device gets it" : ""}. A backup of the
            current data is saved beside the database first.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingImport(null)}>Cancel</Button>
          <Button variant="contained" disableElevation onClick={importFile} sx={{ fontWeight: 800 }}>
            Import
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
