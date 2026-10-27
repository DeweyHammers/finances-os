/**
 * meta.ts — app facts and maintenance actions behind the Settings page.
 *
 *  - getAppMeta():      version, run mode, platform, database location, links
 *  - checkForUpdates(): latest GitHub Release vs the running version
 *  - listBackups() / createBackup(): timestamped .bak copies of the REAL
 *    database beside it (same naming as scripts/db-sync.cjs and Sandbox Keep)
 *
 * No Electron imports on purpose: this runs inside the installed app, the
 * hosted server (server/index.ts) and the route tests alike.
 */
import fs from "fs";
import path from "path";
import { getStore, getRealDatabaseUrl, databaseUrlToPath } from "../shared/db";
import { isSandboxActive } from "./sandbox";

export const GITHUB_REPO = "DeweyHammers/finances-os";
export const REPO_URL = `https://github.com/${GITHUB_REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
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
  releasesUrl: string;
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
    releasesUrl: RELEASES_URL,
    issuesUrl: ISSUES_URL,
    docsUrl: DOCS_URL,
  };
}

// ── Update check ────────────────────────────────────────────────────────────

export interface UpdateCheck {
  current: string;
  latest: string;
  /** Release page to download from. */
  url: string;
  updateAvailable: boolean;
  checkedAt: string;
}

/** Numeric dotted compare ("1.2.0" vs "1.10.0"); a leading "v" is ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Asks GitHub for the latest Release of this repo. Network failures throw —
 * the route turns them into a 502 the Settings page can show. `fetchImpl`
 * exists for the tests; the 6 s timeout keeps a dead network from hanging
 * the button.
 */
export async function checkForUpdates(
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateCheck> {
  const current = readVersion();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetchImpl(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `finances-os/${current}`,
        },
        signal: ctrl.signal,
      },
    );
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const json = (await res.json()) as { tag_name?: string; html_url?: string };
    const latest = String(json.tag_name ?? "").replace(/^v/i, "");
    if (!latest) throw new Error("No release found");
    return {
      current,
      latest,
      url: json.html_url ?? RELEASES_URL,
      updateAvailable: compareVersions(latest, current) > 0,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
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
  BackupInfo & { file: string; at: string; method: "vacuum" | "copy" }
> {
  if (isSandboxActive()) {
    throw new BackupError("Finish the sandbox (Keep or Discard) before backing up.");
  }
  const real = realDbPath();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `${real}.${stamp}.bak`;
  let method: "vacuum" | "copy" = "vacuum";
  try {
    const target = file.replace(/\\/g, "/").replace(/'/g, "''");
    await getStore().raw(`VACUUM INTO '${target}'`);
  } catch (err) {
    console.warn("VACUUM INTO failed, copying the file instead:", err);
    fs.copyFileSync(real, file);
    method = "copy";
  }
  return { ...listBackups(), file, at: new Date().toISOString(), method };
}
