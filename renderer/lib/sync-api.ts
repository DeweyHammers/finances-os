/**
 * Renderer side of sync (main/sync.ts): status, connect / sync now / forget,
 * export and import. Like sandbox-api.ts and meta-api.ts these bypass Refine
 * because none of them is a resource. The token travels only in a POST body
 * and is never read back — the status carries the URL alone.
 */
import { API_URL } from "./api-url";

export type SyncState = "local" | "synced" | "syncing" | "offline" | "paused" | "blocked";

export interface SyncStatus {
  configured: boolean;
  url: string | null;
  state: SyncState;
  lastSyncedAt: string | null;
  lastError: string | null;
  syncing: boolean;
  pausedBy: "sandbox" | null;
  schemaGate: { app: number; database: number } | null;
  readOnly: boolean;
  writesBlocked: string | null;
  replicaPath: string | null;
  appSchemaVersion: number;
}

export interface RemoteFacts {
  empty: boolean;
  schemaVersion: number;
  dataRows: number;
  tables: number;
}

export interface ImportResult {
  dataRows: number;
  schemaVersion: number;
  backupPath: string;
  target: "local" | "cloud";
}

/** An error answer from /api/sync/*, with the server's code when it sent one. */
export class SyncApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "SyncApiError";
  }
}

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new SyncApiError(body?.error || `${res.status} ${res.statusText}`, res.status, body?.code, body?.details);
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function fetchSyncStatus(signal?: AbortSignal): Promise<SyncStatus> {
  return parse<SyncStatus>(await fetch(`${API_URL}/sync`, { signal, cache: "no-store" }));
}

export async function probeRemote(url: string, token: string): Promise<RemoteFacts> {
  return parse<RemoteFacts>(await fetch(`${API_URL}/sync/probe`, json({ url, token })));
}

export async function connectSync(url: string, token: string, source?: "local" | "cloud"): Promise<SyncStatus> {
  return parse<SyncStatus>(await fetch(`${API_URL}/sync/connect`, json({ url, token, source })));
}

export async function syncNow(): Promise<SyncStatus> {
  return parse<SyncStatus>(await fetch(`${API_URL}/sync/now`, { method: "POST" }));
}

export async function disconnectSync(): Promise<SyncStatus & { backupPath: string | null }> {
  return parse(await fetch(`${API_URL}/sync/disconnect`, { method: "POST" }));
}

/**
 * Export: fetch the database file and hand it to the browser as a download.
 * A blob + anchor works the same in the Electron window (which shows the
 * system "Save as" dialog) and in a plain browser tab.
 */
export async function downloadExport(): Promise<string> {
  const res = await fetch(`${API_URL}/sync/export`, { cache: "no-store" });
  if (!res.ok) await parse(res); // throws with the server's message
  const disposition = res.headers.get("content-disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "Finances OS export.db";
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
  return name;
}

/** Import: the file's bytes are the request body. */
export async function uploadImport(file: File): Promise<ImportResult> {
  const res = await fetch(`${API_URL}/sync/import`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: await file.arrayBuffer(),
  });
  return parse<ImportResult>(res);
}
