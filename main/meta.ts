/**
 * meta.ts — app facts and maintenance actions behind the Settings page.
 *
 *  - getAppMeta():      version, run mode, platform, database location, links
 *  - listBackups() / createBackup(): timestamped .bak copies of the REAL
 *    database beside it (same naming as scripts/db-sync.cjs and Sandbox Keep)
 *
 * No Electron imports on purpose: this runs inside the installed app, the
 * hosted server (server/index.ts) and the route tests alike.
 */
import fs from "fs";
import path from "path";
import { getRealDatabaseUrl, databaseUrlToPath } from "../shared/db";
import { isSandboxActive } from "./sandbox";
import { backupFilePath, snapshotCurrentDatabase } from "./sync";

export const GITHUB_REPO = "DeweyHammers/finances-os";
export const REPO_URL = `https://github.com/${GITHUB_REPO}`;
export const ISSUES_URL = `${REPO_URL}/issues`;
/** The picture tour (docs/ → GitHub Pages). */
export const DOCS_URL = "https://deweyhammers.github.io/finances-os/";

/**
 * How the server is running:
 *  - "electron": the installed desktop app (local database on this PC)
 *  - "dev":      `npm run dev`, tests, or the demo server
 *  - "hosted":   server/index.ts serving the UI + API from one origin
 */
export type AppMode = "electron" | "dev" | "hosted";

export interface AppMeta {
  version: string;
  mode: AppMode;
  platform: NodeJS.Platform;
  /** Filesystem path of the REAL database (the sandbox copy is never shown). */
  databasePath: string;
  repoUrl: string;
  issuesUrl: string;
  docsUrl: string;
}

/**
 * Version from package.json. One level above main/ in dev and tests, and one
 * level above app/ (= resources/app/package.json) in the packaged app, so
 * `__dirname/..` covers both; cwd is the fallback for tsx-run scripts.
 */
export function readVersion(): string {
  const candidates = [
    path.join(__dirname, "..", "package.json"),
    path.join(process.cwd(), "package.json"),
  ];
  for (const file of candidates) {
    try {
      const v = JSON.parse(fs.readFileSync(file, "utf8")).version;
      if (typeof v === "string" && v) return v;
    } catch {
      /* try the next one */
    }
  }
  return process.env.npm_package_version ?? "0.0.0";
}

export function getAppMode(): AppMode {
  if (process.env.FINANCES_OS_MODE === "hosted") return "hosted";
  // The demo server (scripts/demo/serve.ts) poses as the installed app for
  // the tour's pictures; only the Settings labels read the mode.
  if (process.env.FINANCES_OS_MODE === "electron") return "electron";
  if (process.versions.electron && process.env.NODE_ENV === "production") return "electron";
  return "dev";
}

export function getAppMeta(): AppMeta {
  return {
    version: readVersion(),
    mode: getAppMode(),
    platform: process.platform,
    databasePath: realDbPath(),
    repoUrl: REPO_URL,
    issuesUrl: ISSUES_URL,
    docsUrl: DOCS_URL,
  };
}

// ── Backups ─────────────────────────────────────────────────────────────────

export interface BackupInfo {
  /** Folder the .bak files live in (beside the database). */
  directory: string;
  count: number;
  lastBackupAt: string | null;
  lastBackupFile: string | null;
}

export class BackupError extends Error {
  constructor(message: string, public readonly status = 409) {
    super(message);
    this.name = "BackupError";
  }
}

/** Native-separator path of the real database (the `file:` URL uses `/`). */
function realDbPath(): string {
  return path.normalize(databaseUrlToPath(getRealDatabaseUrl()));
}

/** `<database file>.<stamp>.bak` files beside the real database, newest first. */
function backupFiles(): { file: string; mtime: Date }[] {
  const real = realDbPath();
  const dir = path.dirname(real);
  const base = path.basename(real);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.`) && f.endsWith(".bak"))
    .map((f) => {
      const file = path.join(dir, f);
      return { file, mtime: fs.statSync(file).mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

export function listBackups(): BackupInfo {
  const files = backupFiles();
  return {
    directory: path.dirname(realDbPath()),
    count: files.length,
    lastBackupAt: files[0]?.mtime.toISOString() ?? null,
    lastBackupFile: files[0]?.file ?? null,
  };
}

/**
 * Snapshot the REAL database to a timestamped .bak beside it. Uses SQLite's
 * own `VACUUM INTO` (a consistent copy even while the app is writing); if the
 * engine refuses it, falls back to a plain file copy and says so in `method`.
 * Refused while a sandbox is active: the store would then point at the
 * scratch copy, and a backup of that is not what the user means.
 */
export async function createBackup(): Promise<
  BackupInfo & { file: string; at: string; method: "vacuum" | "copy" | "dump" }
> {
  if (isSandboxActive()) {
    throw new BackupError("Finish the sandbox (Keep or Discard) before backing up.");
  }
  // A replica (sync on) can't VACUUM — its rows are dumped through the data
  // layer instead (main/sync.ts → snapshotCurrentDatabase); the file is a
  // plain SQLite database either way.
  const file = backupFilePath();
  const method = await snapshotCurrentDatabase(file);
  return { ...listBackups(), file, at: new Date().toISOString(), method };
}
