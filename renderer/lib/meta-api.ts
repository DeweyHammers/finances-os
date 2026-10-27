/**
 * Renderer side of the Settings page's non-resource calls (main/meta.ts):
 * app facts, the GitHub update check and database backups. Like
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

export interface UpdateCheck {
  current: string;
  latest: string;
  url: string;
  updateAvailable: boolean;
  checkedAt: string;
}

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

export async function fetchUpdateCheck(): Promise<UpdateCheck> {
  return parse<UpdateCheck>(await fetch(`${API_URL}/meta/updates`, { cache: "no-store" }));
}

export async function fetchBackups(): Promise<BackupInfo> {
  return parse<BackupInfo>(await fetch(`${API_URL}/backups`, { cache: "no-store" }));
}

export async function createBackup(): Promise<BackupResult> {
  return parse<BackupResult>(await fetch(`${API_URL}/backups`, { method: "POST" }));
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
