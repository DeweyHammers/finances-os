/**
 * updates.ts — in-app updates: the state behind Settings → General's
 * "Check for updates" row and the three actions it offers (check, download,
 * install), on top of a pluggable update ENGINE.
 *
 *  - In the installed app the engine is electron-updater's `autoUpdater`
 *    (wired by main/updater.ts, the only Electron-aware part). It reads the
 *    latest GitHub Release's `latest.yml`, downloads the installer with
 *    progress, and `quitAndInstall` runs it silently and relaunches the app.
 *  - Everywhere else (`npm run dev`, the hosted server, the tests) there is
 *    no engine: a check falls back to main/meta.ts's plain GitHub API lookup
 *    so the Settings row can still say "Version X is available" with a link
 *    to the Release page, and download/install are refused (409).
 *
 * This module itself has NO Electron imports and never loads electron-updater
 * (`registerUpdateEngine` is handed an object), so the route tests drive the
 * whole state machine with a fake engine (updates.test.ts).
 *
 * Rules (task brief, Oct 28 2026): nothing is ever installed without the user
 * clicking "Restart to update"; a startup check, if any, is silent and never
 * downloads (see main/updater.ts).
 */
import { checkForUpdates, compareVersions, readVersion, RELEASES_URL } from "./meta";

// ── Public shapes (mirrored in renderer/lib/meta-api.ts) ────────────────────

export type UpdateState =
  | "idle" // nothing checked yet
  | "checking"
  | "up-to-date"
  | "available" // a newer release exists; not downloaded
  | "downloading"
  | "downloaded" // installer on disk, waiting for "Restart to update"
  | "installing" // quitAndInstall has been scheduled
  | "error";

export interface UpdateProgress {
  /** 0–100. */
  percent: number;
  /** Bytes so far / in total. */
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export interface UpdateStatus {
  /** True when an engine is wired, i.e. the app can download + install itself. */
  supported: boolean;
  state: UpdateState;
  /** Running version (package.json). */
  current: string;
  /** Newest known release, once a check has answered. */
  latest: string | null;
  releaseDate: string | null;
  /** The Release page — the manual "Download" link when `supported` is false. */
  releaseUrl: string;
  /** Only while downloading. */
  progress: UpdateProgress | null;
  /** The last failure's message (state "error"). */
  error: string | null;
  checkedAt: string | null;
}

/**
 * The slice of electron-updater's `AppUpdater` this module uses. Kept this
 * small so a test can hand in a plain object.
 */
export interface UpdateEngine {
  checkForUpdates(): Promise<{
    isUpdateAvailable?: boolean;
    updateInfo: { version: string; releaseDate?: string | null };
  } | null>;
  /** Resolves when the installer is fully on disk (and verified). */
  downloadUpdate(): Promise<unknown>;
  /** Closes the app, runs the installer, relaunches. */
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: "download-progress", listener: (progress: UpdateProgress) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

/** A wrong-state call (download before check, install before download…). */
export class UpdateError extends Error {
  constructor(
    message: string,
    public readonly status = 409,
    public readonly code: "UPDATER_UNAVAILABLE" | "WRONG_STATE" = "WRONG_STATE",
  ) {
    super(message);
    this.name = "UpdateError";
  }
}

// ── State ───────────────────────────────────────────────────────────────────

let engine: UpdateEngine | null = null;
let state: UpdateState = "idle";
let latest: string | null = null;
let releaseDate: string | null = null;
let progress: UpdateProgress | null = null;
let lastError: string | null = null;
let checkedAt: string | null = null;
/** The in-flight check, so two clicks share one request. */
let checking: Promise<UpdateStatus> | null = null;
/** The in-flight download or scheduled install, awaited by the tests. */
let pending: Promise<unknown> | null = null;

/**
 * How long installUpdate waits before quitAndInstall: long enough for the
 * HTTP response to reach the renderer (which shows "Restarting…"), short
 * enough that the user never wonders.
 */
export const INSTALL_DELAY_MS = 400;

/**
 * Wire the engine (main/updater.ts, installed app only). Attaches the
 * progress listener and — important — an `error` listener: electron-updater
 * emits "error" on every failure, and a Node EventEmitter with no listener
 * for it would crash the main process.
 */
export function registerUpdateEngine(next: UpdateEngine | null): void {
  engine = next;
  if (!next) return;
  next.on("download-progress", (p) => {
    progress = {
      percent: Math.max(0, Math.min(100, Number(p.percent) || 0)),
      transferred: Number(p.transferred) || 0,
      total: Number(p.total) || 0,
      bytesPerSecond: Number(p.bytesPerSecond) || 0,
    };
  });
  next.on("error", (e) => {
    // The action that failed also rejects its promise, and that path sets
    // the state; this listener only exists so the event is not unhandled.
    console.error("[Updates] engine error:", e?.message ?? e);
  });
}

export function getUpdateStatus(): UpdateStatus {
  return {
    supported: engine !== null,
    state,
    current: readVersion(),
    latest,
    releaseDate,
    releaseUrl: RELEASES_URL,
    progress: state === "downloading" ? progress : null,
    error: state === "error" ? lastError : null,
    checkedAt,
  };
}

function fail(e: unknown): UpdateStatus {
  state = "error";
  lastError = e instanceof Error ? e.message : String(e);
  progress = null;
  return getUpdateStatus();
}

// ── Actions ─────────────────────────────────────────────────────────────────

export interface CheckOptions {
  /**
   * A background check (startup): a failure goes back to "idle" instead of
   * "error", so the Settings row never opens on a complaint the user didn't
   * ask for. A result ("available" / "up-to-date") is kept either way.
   */
  silent?: boolean;
  /** Test hook for the no-engine fallback (main/meta.ts → checkForUpdates). */
  fetchImpl?: typeof fetch;
}

/**
 * Ask for the newest release. With an engine: electron-updater reads
 * latest.yml from the latest GitHub Release. Without: the GitHub API lookup
 * in main/meta.ts (hosted / dev — install impossible, link only).
 *
 * Resolves to the resulting status; errors are folded into it (state
 * "error") rather than thrown, since they are what the row should show.
 * Joins an in-flight check; refuses nothing — but a download in progress or
 * finished is left alone (the status just reports it).
 */
export function checkForUpdate(opts: CheckOptions = {}): Promise<UpdateStatus> {
  if (checking) return checking;
  if (state === "downloading" || state === "downloaded" || state === "installing") {
    return Promise.resolve(getUpdateStatus());
  }
  const before = state;
  state = "checking";
  progress = null;
  checking = (async () => {
    try {
      if (engine) {
        const result = await engine.checkForUpdates();
        if (!result) throw new Error("No update feed for this build");
        const info = result.updateInfo;
        latest = info.version;
        releaseDate = info.releaseDate ?? null;
        const available =
          typeof result.isUpdateAvailable === "boolean"
            ? result.isUpdateAvailable
            : compareVersions(info.version, readVersion()) > 0;
        state = available ? "available" : "up-to-date";
      } else {
        const r = await checkForUpdates(opts.fetchImpl);
        latest = r.latest;
        releaseDate = null;
        state = r.updateAvailable ? "available" : "up-to-date";
      }
      checkedAt = new Date().toISOString();
      lastError = null;
      return getUpdateStatus();
    } catch (e) {
      if (opts.silent) {
        // Back to where we were, quietly (a dead network at startup is normal).
        state = before === "checking" ? "idle" : before;
        return getUpdateStatus();
      }
      return fail(e);
    } finally {
      checking = null;
    }
  })();
  return checking;
}

/**
 * Start downloading the release found by the last check. Returns at once
 * with state "downloading"; the renderer polls getUpdateStatus for progress
 * until "downloaded" (or "error"). Needs an engine and state "available".
 */
export function downloadUpdate(): UpdateStatus {
  if (!engine) {
    throw new UpdateError(
      "This build can't update itself — download the installer from the Release page.",
      409,
      "UPDATER_UNAVAILABLE",
    );
  }
  if (state === "downloading" || state === "downloaded") return getUpdateStatus();
  if (state !== "available") {
    throw new UpdateError("Check for updates first — there is nothing to download.");
  }
  state = "downloading";
  progress = { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 };
  pending = engine
    .downloadUpdate()
    .then(() => {
      state = "downloaded";
      progress = null;
    })
    .catch(fail);
  return getUpdateStatus();
}

/**
 * Close the app, run the downloaded installer silently and relaunch. Only
 * ever called from the user's click on "Restart to update" (the route), and
 * only once a download finished. The quit is delayed by INSTALL_DELAY_MS so
 * the HTTP response gets out first.
 */
export function installUpdate(): UpdateStatus {
  if (!engine) {
    throw new UpdateError("This build can't update itself.", 409, "UPDATER_UNAVAILABLE");
  }
  if (state === "installing") return getUpdateStatus();
  if (state !== "downloaded") {
    throw new UpdateError("Download the update first — there is nothing to install.");
  }
  state = "installing";
  const target = engine;
  pending = new Promise<void>((resolve) => {
    setTimeout(() => {
      try {
        // isSilent: no installer pages (the user already chose the folder
        // once); isForceRunAfter: open the new version when it's done.
        target.quitAndInstall(true, true);
      } catch (e) {
        fail(e);
      }
      resolve();
    }, INSTALL_DELAY_MS);
  });
  return getUpdateStatus();
}

// ── Test hooks ──────────────────────────────────────────────────────────────

/** Wait for the download or install the last action started. */
export async function awaitPendingUpdateWorkForTests(): Promise<void> {
  await checking;
  await pending;
}

/** Back to a fresh process: no engine, nothing checked. */
export function resetUpdatesForTests(): void {
  engine = null;
  state = "idle";
  latest = null;
  releaseDate = null;
  progress = null;
  lastError = null;
  checkedAt = null;
  checking = null;
  pending = null;
}
