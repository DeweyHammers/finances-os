/**
 * sync-settings.ts — where this device keeps its sync configuration.
 *
 *   sync.json beside the database   { url, token: { kind, data } }
 *
 * The database URL is plain text (it is not a secret: anyone can see it, but
 * nobody can read the database without the token). The token is encrypted
 * with Electron's `safeStorage` — DPAPI on Windows, bound to the Windows user
 * account — and stored base64-encoded. It is NEVER written into the database
 * itself (user decision, plans/phone-app-and-sync.md): the database is the
 * thing that gets synced, exported and backed up.
 *
 * Outside Electron (the route tests, `scripts/demo/serve.ts`, the hosted
 * server) there is no safeStorage. The token is then stored IN PLAIN TEXT
 * with `kind: "plain"` — acceptable only because those contexts never hold a
 * real token (tests use a fake transport; the demo server is local only).
 * A loud warning is logged whenever that happens so it can't go unnoticed.
 */
import fs from "fs";
import path from "path";
import { safeStorage } from "electron";
import { databaseUrlToPath, getRealDatabaseUrl } from "../shared/db";

export const SYNC_SETTINGS_FILENAME = "sync.json";

export interface SyncSettings {
  /** The remote database URL as the user pasted it (`libsql://…` or `https://…`). */
  url: string;
  authToken: string;
}

interface StoredToken {
  kind: "safeStorage" | "plain";
  /** base64 of the DPAPI blob, or the token itself when plain. */
  data: string;
}

interface StoredSettings {
  url: string;
  token: StoredToken;
  savedAt: string;
}

/** `sync.json` beside the real database (prisma/ in dev, %APPDATA% in PROD). */
export function syncSettingsPath(): string {
  return path.join(path.dirname(path.normalize(databaseUrlToPath(getRealDatabaseUrl()))), SYNC_SETTINGS_FILENAME);
}

/** True when Electron's OS-backed encryption can be used for the token. */
export function canEncryptToken(): boolean {
  try {
    return !!safeStorage && typeof safeStorage.isEncryptionAvailable === "function" && safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encryptToken(token: string): StoredToken {
  if (canEncryptToken()) {
    return { kind: "safeStorage", data: safeStorage.encryptString(token).toString("base64") };
  }
  // ── PLAIN-TEXT FALLBACK ── no safeStorage here (not running inside
  // Electron). Only tests and local dev servers reach this; see the file
  // comment. The warning stays loud on purpose.
  console.warn(
    "[Sync] safeStorage is not available — the sync token is being saved in PLAIN TEXT in " +
      syncSettingsPath() +
      " (expected only in tests and the demo server, never in the installed app).",
  );
  return { kind: "plain", data: token };
}

function decryptToken(stored: StoredToken): string {
  if (stored.kind === "plain") return stored.data;
  if (!canEncryptToken()) {
    throw new Error("The saved sync token is encrypted but this environment cannot decrypt it (no safeStorage).");
  }
  return safeStorage.decryptString(Buffer.from(stored.data, "base64"));
}

/** The saved configuration, or null when this device is local only. */
export function loadSyncSettings(): SyncSettings | null {
  const file = syncSettingsPath();
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<StoredSettings>;
  if (typeof raw.url !== "string" || !raw.token || typeof raw.token.data !== "string") {
    throw new Error(`${file} is not a valid sync settings file.`);
  }
  return { url: raw.url, authToken: decryptToken(raw.token as StoredToken) };
}

export function saveSyncSettings(settings: SyncSettings): void {
  const stored: StoredSettings = {
    url: settings.url,
    token: encryptToken(settings.authToken),
    savedAt: new Date().toISOString(),
  };
  const file = syncSettingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(stored, null, 2) + "\n", "utf8");
}

/** "Forget this device": the URL and token are gone; the data stays. */
export function clearSyncSettings(): void {
  const file = syncSettingsPath();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
