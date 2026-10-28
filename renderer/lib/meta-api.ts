/**
 * Renderer side of the Settings page's non-resource calls (main/meta.ts,
 * main/updates.ts): app facts, in-app updates and database backups. Like
 * sandbox-api.ts these bypass Refine because none of them is a resource.
 */
import { API_URL } from "./api-url";

export type AppMode = "electron" | "dev" | "hosted";

export interface AppMeta {
  version: string;
  mode: AppMode;
  platform: string;
  databasePath: string;
  repoUrl: string;
  releasesUrl: string;
  issuesUrl: string;
  docsUrl: string;
}

// ── In-app updates (main/updates.ts; shapes mirrored from there) ────────────

export type UpdateState =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export interface UpdateStatus {
  /** The installed app can download + install; dev/hosted can only link. */
  supported: boolean;
  state: UpdateState;
  current: string;
  latest: string | null;
  releaseDate: string | null;
  releaseUrl: string;
  progress: UpdateProgress | null;
  error: string | null;
  checkedAt: string | null;
}

export type UpdateAction = "check" | "download" | "install";

export interface BackupInfo {
  directory: string;
  count: number;
  lastBackupAt: string | null;
  lastBackupFile: string | null;
}

export interface BackupResult extends BackupInfo {
  file: string;
  at: string;
  method: "vacuum" | "copy";
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as any)?.error || `${res.status} ${res.statusText}`);
  }
  return body as T;
}

export async function fetchMeta(signal?: AbortSignal): Promise<AppMeta> {
  return parse<AppMeta>(await fetch(`${API_URL}/meta`, { signal, cache: "no-store" }));
}

/** Where the updater stands right now (polled while checking/downloading). */
export async function fetchUpdateStatus(signal?: AbortSignal): Promise<UpdateStatus> {
  return parse<UpdateStatus>(await fetch(`${API_URL}/updates/status`, { signal, cache: "no-store" }));
}

/**
 * check: answers with the resulting status (a failure is inside it, state
 * "error"). download / install: answer at once; poll fetchUpdateStatus.
 * A wrong-state call or an unsupported build is a 409 whose `error` is the
 * message to show.
 */
export async function runUpdateAction(action: UpdateAction): Promise<UpdateStatus> {
  return parse<UpdateStatus>(await fetch(`${API_URL}/updates/${action}`, { method: "POST" }));
}

export async function fetchBackups(): Promise<BackupInfo> {
  return parse<BackupInfo>(await fetch(`${API_URL}/backups`, { cache: "no-store" }));
}

export async function createBackup(): Promise<BackupResult> {
  const result = parse<BackupResult>(await fetch(`${API_URL}/backups`, { method: "POST" }));
  backupsCache = await result;
  return result;
}

// ── App-session cache ───────────────────────────────────────────────────────
// The Settings popup mounts its content fresh on every open, and its General
// tab disabled the link buttons until /api/meta answered — a visible blink on
// each open. App facts don't change while the app runs and the backup list
// only changes through createBackup (which updates the cache), so both are
// fetched once per session (prefetched by SettingsDialogProvider on start)
// and handed to the page synchronously afterwards.

let metaCache: AppMeta | null = null;
let metaPromise: Promise<AppMeta> | null = null;
let backupsCache: BackupInfo | null = null;
let backupsPromise: Promise<BackupInfo> | null = null;

/** The app facts, fetched once; a failed fetch is retried on the next call. */
export function loadMeta(): Promise<AppMeta> {
  if (metaCache) return Promise.resolve(metaCache);
  metaPromise ??= fetchMeta()
    .then((m) => (metaCache = m))
    .catch((e) => {
      metaPromise = null;
      throw e;
    });
  return metaPromise;
}

/** What loadMeta() already has, for a synchronous first render. */
export function cachedMeta(): AppMeta | null {
  return metaCache;
}

/** The backup list, fetched once and kept current by createBackup(). */
export function loadBackups(): Promise<BackupInfo> {
  if (backupsCache) return Promise.resolve(backupsCache);
  backupsPromise ??= fetchBackups()
    .then((b) => (backupsCache = b))
    .catch((e) => {
      backupsPromise = null;
      throw e;
    });
  return backupsPromise;
}

export function cachedBackups(): BackupInfo | null {
  return backupsCache;
}

/** Where the API lives, for display: the explicit origin or "this page's". */
export function apiOrigin(): string {
  if (/^https?:\/\//.test(API_URL)) return API_URL.replace(/\/api$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return API_URL;
}

/** Short human labels for `AppMeta.mode`. */
export const MODE_LABELS: Record<AppMode, string> = {
  electron: "Installed app",
  dev: "Development",
  hosted: "Hosted server",
};
