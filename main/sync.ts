/**
 * sync.ts — Phase B of plans/phone-app-and-sync.md: the desktop keeps an
 * embedded replica of a cloud libsql/Turso database the user owns.
 *
 *   Local only (default)   the API is on the real local file, as always.
 *   Synced                 the API is on replica.db beside it, opened with
 *                          the cloud's URL + token (shared/data/backends/
 *                          libsql.ts): reads are local, writes go to the
 *                          cloud and show up locally at once, `sync()` pulls
 *                          what other devices wrote. One source of truth, no
 *                          merge logic.
 *
 * Switching local → synced uploads the local database once (or, when the
 * cloud already holds data, the user chooses which side wins); switching
 * back ("Forget this device") writes the replica's data into the local file
 * so nothing is lost and no token stays behind. Export / Import work in both
 * modes through the data layer's dump/load (shared/data/transfer.ts).
 *
 * Offline: libsql connects to the cloud when it OPENS a replica, so when the
 * cloud is unreachable the replica file is opened plain and READ-ONLY — the
 * user still sees their data, every write is refused with a clear message
 * (`writeBlockReason`, enforced by main/api-server.ts), and each sync tick
 * tries the real replica again. Every open/sync that would block the main
 * process is preceded by an asynchronous reachability check, so a dead
 * network costs a 4 s probe, never a long stall.
 *
 * Schema-version gate: a database stamped by a NEWER app (SchemaVersion >
 * this build's SCHEMA_VERSION) is neither synced nor written; the status
 * says "update the app on this device".
 *
 * Sandbox: entering one dumps the replica into the plain sandbox file and
 * pauses sync; Discard reopens the replica; Keep pushes the sandbox's rows to
 * the cloud and then reopens the replica (main/sandbox.ts calls in here).
 *
 * No Electron imports (sync-settings.ts isolates safeStorage), so this runs
 * in the app, the demo server and the tests alike. The tests swap the
 * transport (`__setSyncTransportForTests`) and the connection opener in
 * shared/db.ts for plain files, so they never touch the network.
 */
import fs from "fs";
import path from "path";
import { createClient, type InValue } from "@libsql/client";
import {
  databaseUrlToPath,
  getCurrentConnection,
  getCurrentTarget,
  getRealDatabaseUrl,
  getStore,
  pathToDatabaseUrl,
  setPrimaryDatabase,
  switchDatabase,
  type DatabaseTarget,
} from "../shared/db";
import { collectGarbage, openLibsql } from "../shared/data/backends/libsql";
import {
  SCHEMA_VERSION,
  countDataRows,
  dumpDatabase,
  getSchemaVersion,
  hasNoTables,
  loadDatabase,
  loadStatements,
  schemaVersionGate,
  type DatabaseDump,
  type Row,
  type SqlExecutor,
  type SqlValue,
  type Statement,
} from "../shared/data";
import { clearSyncSettings, loadSyncSettings, saveSyncSettings, type SyncSettings } from "./sync-settings";
// Circular with main/sandbox.ts on purpose (it calls the pause/resume/keep
// hooks below); both sides only use the other at call time, never at load.
import { isSandboxActive } from "./sandbox";

export const REPLICA_FILENAME = "replica.db";
/** How often the replica pulls the cloud's changes while idle. */
export const SYNC_INTERVAL_MS = 60_000;
/** Pause after a local write before pulling (writes already reached the cloud). */
export const SYNC_AFTER_WRITE_MS = 3_000;
const REACHABILITY_TIMEOUT_MS = 8_000;
/** A probe this fresh is trusted before a write instead of probing again. */
const WRITE_PROBE_MAX_AGE_MS = 5_000;
const UNREACHABLE = "The cloud database can't be reached.";
/** Statements per cloud batch (= per transaction) when pushing a whole database. */
const BATCH_SIZE = 200;

// ── Public types ────────────────────────────────────────────────────────────

export type SyncState = "local" | "synced" | "syncing" | "offline" | "paused" | "blocked";

export interface SyncStatus {
  /** A cloud database is set up on this device. False = local only. */
  configured: boolean;
  /** The cloud database URL (not a secret; the token is never reported). */
  url: string | null;
  state: SyncState;
  lastSyncedAt: string | null;
  lastError: string | null;
  syncing: boolean;
  pausedBy: "sandbox" | null;
  /** Set when the database's schema is newer than this app's. */
  schemaGate: { app: number; database: number } | null;
  /** The cloud was unreachable when the replica was opened: data is read-only until it is back. */
  readOnly: boolean;
  /** Why writes are refused right now, null when they are allowed. */
  writesBlocked: string | null;
  replicaPath: string | null;
  appSchemaVersion: number;
}

/** What a cloud database looks like before this device joins it. */
export interface RemoteFacts {
  empty: boolean;
  /** Highest SchemaVersion stamp, 0 when the database has no tables yet. */
  schemaVersion: number;
  dataRows: number;
  tables: number;
}

/** Caller mistakes (wrong state, bad input) and cloud failures → HTTP status. */
export class SyncError extends Error {
  constructor(
    message: string,
    public readonly status = 409,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

// ── Transport (the only part that touches the network) ─────────────────────

export interface RemoteDatabase extends SqlExecutor {
  /** Run statements in order inside one transaction. */
  batch(statements: Statement[]): Promise<void>;
  close(): void;
}

export interface SyncTransport {
  /** A direct connection to the cloud database (probe, first upload, pushes). */
  openRemote(settings: SyncSettings): RemoteDatabase;
  /** Can the cloud be reached right now? Must never block the process. */
  isReachable(settings: SyncSettings): Promise<boolean>;
}

/** `libsql://host` → `https://host`; trailing slashes dropped. */
export function toHttpUrl(url: string): string {
  return url.trim().replace(/^libsql:\/\//i, "https://").replace(/\/+$/, "");
}

/** The URL forms Turso hands out, plus http for a local libsql-server. */
export function isValidSyncUrl(url: string): boolean {
  return /^(libsql|https?):\/\/[^\s/?#]+(\/[^\s]*)?$/i.test(url.trim());
}

function toSqlValue(v: unknown): SqlValue {
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (v === undefined) return null;
  return v as SqlValue;
}

const realTransport: SyncTransport = {
  openRemote(settings) {
    const client = createClient({ url: toHttpUrl(settings.url), authToken: settings.authToken });
    return {
      async exec(sql, params = []) {
        const result = await client.execute({ sql, args: params as InValue[] });
        return result.rows.map((row) => {
          const out: Row = {};
          result.columns.forEach((col, i) => (out[col] = toSqlValue(row[i])));
          return out;
        });
      },
      async batch(statements) {
        await client.batch(
          statements.map((s) => ({ sql: s.sql, args: s.args as InValue[] })),
          "write",
        );
      },
      close: () => client.close(),
    };
  },
  async isReachable(settings) {
    // Any HTTP answer counts (libsql-server exposes /health; a 401/404 still
    // proves the host is up); only a network failure or timeout is "offline".
    // A cold TLS round trip to Turso's edge measured 2.4 s (Oct 2026), so
    // the timeout is generous, and a failed /health gets a second chance
    // through a real `select 1` on the client — the probe must err on the
    // side of "reachable", because a false "offline" refuses a save.
    try {
      await fetch(`${toHttpUrl(settings.url)}/health`, { signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS) });
      return true;
    } catch {
      /* fall through to the query */
    }
    const client = createClient({ url: toHttpUrl(settings.url), authToken: settings.authToken });
    try {
      await Promise.race([
        client.execute("select 1"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), REACHABILITY_TIMEOUT_MS).unref?.()),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      client.close();
    }
  },
};

let transport: SyncTransport = realTransport;

export function __setSyncTransportForTests(t: SyncTransport | null): void {
  transport = t ?? realTransport;
}

// ── State ───────────────────────────────────────────────────────────────────

interface State {
  settings: SyncSettings | null;
  syncing: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  pausedBy: "sandbox" | null;
  schemaGate: { app: number; database: number } | null;
  readOnly: boolean;
}

const state: State = {
  settings: null,
  syncing: false,
  lastSyncedAt: null,
  lastError: null,
  pausedBy: null,
  schemaGate: null,
  readOnly: false,
};

let timer: NodeJS.Timeout | null = null;
let afterWriteTimer: NodeJS.Timeout | null = null;
let lastProbe: { at: number; reachable: boolean } | null = null;

/**
 * Is the cloud reachable? Every blocking libsql call (open, sync, and —
 * through the write gate — a forwarded write) is preceded by this, because a
 * libsql call against a dead host blocks the whole process until TCP gives
 * up (measured Oct 2026: a write sat 5+ minutes while the server was
 * paused). `maxAgeMs` lets writes reuse a probe taken moments ago.
 */
async function reachableNow(settings: SyncSettings, maxAgeMs = 0): Promise<boolean> {
  if (lastProbe && Date.now() - lastProbe.at < maxAgeMs) return lastProbe.reachable;
  const reachable = await transport.isReachable(settings);
  lastProbe = { at: Date.now(), reachable };
  if (reachable && state.lastError === UNREACHABLE) state.lastError = null;
  return reachable;
}

export function __forgetReachabilityForTests(): void {
  lastProbe = null;
}

function realDbPath(): string {
  return path.normalize(databaseUrlToPath(getRealDatabaseUrl()));
}

/** `replica.db` beside the real database. */
export function replicaDbPath(): string {
  return path.join(path.dirname(realDbPath()), REPLICA_FILENAME);
}

/** The store as a plain executor (dump/load read through it, statement by statement). */
function storeExecutor(): SqlExecutor {
  return { exec: (sql, params = []) => getStore().raw(sql, params) };
}

function replicaTarget(settings: SyncSettings): DatabaseTarget {
  return {
    url: pathToDatabaseUrl(replicaDbPath()),
    sync: { syncUrl: toHttpUrl(settings.url), authToken: settings.authToken },
  };
}

/** A sandbox is on — synced (paused here) or local only (main/sandbox.ts knows). */
function sandboxOn(): boolean {
  return state.pausedBy !== null || isSandboxActive();
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Delete the replica and libsql's side files (`replica.db-wal`,
 * `-client_wal_index`, …). Windows reports EBUSY/EPERM for a short while
 * after a close, so retry briefly (same as main/sandbox.ts).
 */
async function removeReplicaFiles(): Promise<void> {
  const dir = path.dirname(replicaDbPath());
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f === REPLICA_FILENAME || f.startsWith(`${REPLICA_FILENAME}-`))
    .map((f) => path.join(dir, f));
  for (const file of files) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        fs.rmSync(file, { force: true });
        break;
      } catch (e) {
        if (attempt === 19) throw e;
        // The replicator's handle goes when its JS wrapper is finalised,
        // which takes a GC plus a tick plus a few ms (measured Oct 2026: held
        // right after close(), free one GC round later).
        collectGarbage();
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
}

export function isSyncConfigured(): boolean {
  return state.settings !== null;
}

/** Why a write must be refused right now (main/api-server.ts), or null. */
export function writeBlockReason(): string | null {
  if (!state.settings) return null;
  if (state.schemaGate) return schemaVersionGate(state.schemaGate.database);
  if (state.readOnly && !state.pausedBy) {
    return "Offline: the cloud database can't be reached, so changes can't be saved right now. Your data is shown read-only until it is back.";
  }
  // The last probe (a sync, a write) found the cloud unreachable: the next
  // write would be refused too, so the status says so up front (the banner
  // and the indicator read this). Cleared by the next successful probe.
  if (!state.pausedBy && lastProbe && !lastProbe.reachable) {
    return "Offline: the cloud database can't be reached, so changes can't be saved right now. Try again when you're back online.";
  }
  return null;
}

/**
 * The write gate main/api-server.ts awaits before every mutating resource
 * route: the static reasons above, plus — on an open replica — a reachability
 * probe (cached 5 s), because a forwarded write to a dead host would block
 * the process. Local-only installs resolve to null without any probe.
 */
export async function writeBlockReasonNow(): Promise<string | null> {
  const fixed = writeBlockReason();
  if (fixed) return fixed;
  if (!state.settings || state.pausedBy || state.readOnly) return null;
  if (!(await reachableNow(state.settings, WRITE_PROBE_MAX_AGE_MS))) {
    state.lastError = UNREACHABLE;
    return "Offline: the cloud database can't be reached, so this change can't be saved right now. Try again when you're back online.";
  }
  return null;
}

export function getSyncStatus(): SyncStatus {
  const configured = isSyncConfigured();
  let syncState: SyncState = "local";
  if (configured) {
    if (state.pausedBy) syncState = "paused";
    else if (state.schemaGate) syncState = "blocked";
    else if (state.syncing) syncState = "syncing";
    else if (state.readOnly || state.lastError) syncState = "offline";
    else syncState = "synced";
  }
  return {
    configured,
    url: state.settings?.url ?? null,
    state: syncState,
    lastSyncedAt: state.lastSyncedAt,
    lastError: state.lastError,
    syncing: state.syncing,
    pausedBy: state.pausedBy,
    schemaGate: state.schemaGate,
    readOnly: state.readOnly,
    writesBlocked: writeBlockReason(),
    replicaPath: configured ? replicaDbPath() : null,
    appSchemaVersion: SCHEMA_VERSION,
  };
}

// ── Replica lifecycle ───────────────────────────────────────────────────────

/** Read the replica's schema stamp and raise the gate if it is newer than ours. */
async function checkSchemaGate(): Promise<void> {
  const version = await getSchemaVersion(storeExecutor());
  state.schemaGate = version > SCHEMA_VERSION ? { app: SCHEMA_VERSION, database: version } : null;
}

/** Pull the cloud's frames into the open replica (the store's lock keeps statements out meanwhile). */
async function pullFromCloud(): Promise<void> {
  state.syncing = true;
  try {
    await getStore().sync();
    state.lastSyncedAt = new Date().toISOString();
    state.lastError = null;
    await checkSchemaGate();
  } catch (e) {
    state.lastError = errorMessage(e);
    throw e;
  } finally {
    state.syncing = false;
  }
}

/**
 * Put the API on the replica: the real thing when the cloud answers, the
 * read-only fallback when it doesn't. `beforeConnect` runs once, after the
 * current store has closed (same contract as switchDatabase). Never throws
 * for a network problem — the status carries it; throws only when there is
 * nothing at all to open.
 */
async function activateReplica(beforeConnect?: () => void): Promise<void> {
  const settings = state.settings;
  if (!settings) throw new SyncError("Sync is not set up on this device.");
  const target = replicaTarget(settings);
  setPrimaryDatabase(target);
  const replicaExists = fs.existsSync(replicaDbPath());

  if (await reachableNow(settings)) {
    await switchDatabase(target, beforeConnect);
    beforeConnect = undefined;
    try {
      // libsql connects here; a fresh file is bootstrapped from the cloud.
      await getCurrentConnection().open();
      await pullFromCloud();
      state.readOnly = false;
      return;
    } catch (e) {
      state.lastError = errorMessage(e);
      console.error("[Sync] could not open the replica:", state.lastError);
      await getStore().close();
    }
  } else {
    state.lastError = UNREACHABLE;
  }

  // Fallback: the last replica, read-only. With no replica yet, the local
  // file from before sync was set up (also read-only, so it never diverges).
  state.readOnly = true;
  if (replicaExists || fs.existsSync(replicaDbPath())) {
    await switchDatabase({ url: target.url, readOnly: true }, beforeConnect);
  } else {
    await switchDatabase({ url: getRealDatabaseUrl(), readOnly: true }, beforeConnect);
    state.lastError += " There is no local copy of it yet, so the data from before sync was set up is shown.";
  }
}

/** One idle-time sync attempt: reconnect if the last open fell back, pull otherwise. */
async function tick(): Promise<void> {
  if (!state.settings || state.pausedBy || state.schemaGate || state.syncing) return;
  try {
    if (state.readOnly) {
      if (await reachableNow(state.settings)) await activateReplica();
    } else if (await reachableNow(state.settings)) {
      await pullFromCloud();
    } else {
      state.lastError = UNREACHABLE;
    }
  } catch (e) {
    // Already recorded in the status; the next tick tries again.
    console.warn("[Sync] background sync failed:", errorMessage(e));
  }
}

function startTimer(): void {
  stopTimer();
  timer = setInterval(() => void tick(), SYNC_INTERVAL_MS);
  timer.unref?.();
}

function stopTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (afterWriteTimer) clearTimeout(afterWriteTimer);
  afterWriteTimer = null;
}

/** A route wrote something: pull shortly after, so "last synced" stays honest. */
export function noteLocalWrite(): void {
  if (!state.settings || state.pausedBy) return;
  if (afterWriteTimer) clearTimeout(afterWriteTimer);
  afterWriteTimer = setTimeout(() => {
    afterWriteTimer = null;
    void tick();
  }, SYNC_AFTER_WRITE_MS);
  afterWriteTimer.unref?.();
}

/**
 * Startup: read the saved settings and, when synced, open the replica before
 * the API starts serving. Called once by main.ts (after app.whenReady, which
 * safeStorage needs) and by the tests.
 */
export async function initSync(): Promise<SyncStatus> {
  try {
    state.settings = loadSyncSettings();
  } catch (e) {
    state.settings = null;
    state.lastError = `Could not read the sync settings: ${errorMessage(e)}`;
    console.error("[Sync]", state.lastError);
  }
  if (state.settings) {
    await activateReplica();
    startTimer();
    console.log(`[Sync] synced with ${state.settings.url} (${state.readOnly ? "read-only, cloud unreachable" : "replica open"})`);
  }
  return getSyncStatus();
}

/** Back to the pristine local-only state (tests only). */
export async function __resetSyncForTests(): Promise<void> {
  stopTimer();
  lastProbe = null;
  if (state.settings) {
    await switchDatabase(getRealDatabaseUrl());
    setPrimaryDatabase(getRealDatabaseUrl());
  }
  await removeReplicaFiles();
  clearSyncSettings();
  Object.assign(state, {
    settings: null,
    syncing: false,
    lastSyncedAt: null,
    lastError: null,
    pausedBy: null,
    schemaGate: null,
    readOnly: false,
  } satisfies State);
}

// ── Cloud side ──────────────────────────────────────────────────────────────

async function probe(remote: RemoteDatabase): Promise<RemoteFacts> {
  const tables = (
    await remote.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'libsql_%'",
    )
  ).map((r) => String(r.name));
  const dump = tables.length ? await dumpDatabase(remote) : null;
  return {
    empty: !dump || countDataRows(dump) === 0,
    schemaVersion: dump?.schemaVersion ?? 0,
    dataRows: dump ? countDataRows(dump) : 0,
    tables: tables.length,
  };
}

/** Make the cloud database hold exactly `dump` (schema created when missing). */
async function replaceRemote(remote: RemoteDatabase, dump: DatabaseDump): Promise<void> {
  const statements = loadStatements(dump);
  // Several transactions, in order: the FK ordering keeps every prefix
  // consistent, and a batch stays well under any request-size limit.
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await remote.batch(statements.slice(i, i + BATCH_SIZE));
  }
}

function validateSettings(input: Partial<SyncSettings>): SyncSettings {
  const url = (input.url ?? "").trim();
  const authToken = (input.authToken ?? "").trim();
  if (!isValidSyncUrl(url)) {
    throw new SyncError("Enter the database URL as Turso shows it (libsql://… or https://…).", 400);
  }
  if (!authToken) throw new SyncError("Enter the database token.", 400);
  return { url, authToken };
}

/** Look at a cloud database before joining it (the Connect button's first step). */
export async function probeRemote(input: Partial<SyncSettings>): Promise<RemoteFacts> {
  const settings = validateSettings(input);
  if (!(await transport.isReachable(settings))) {
    throw new SyncError(`${UNREACHABLE} Check the URL and your connection.`, 502);
  }
  const remote = transport.openRemote(settings);
  try {
    return await probe(remote);
  } catch (e) {
    throw new SyncError(`Could not read the cloud database: ${errorMessage(e)}`, 502);
  } finally {
    remote.close();
  }
}

/**
 * Switch this device from local only to synced.
 *
 * `source` says whose data wins when the cloud database is not empty:
 * "local" pushes this device's database up (replacing the cloud's rows),
 * "cloud" leaves the cloud as it is and this device takes its data. Without
 * it, an empty cloud database gets the local data and a non-empty one is
 * refused with code REMOTE_HAS_DATA so the UI can ask.
 */
export async function connectSync(
  input: Partial<SyncSettings> & { source?: "local" | "cloud" },
): Promise<SyncStatus> {
  if (state.settings) throw new SyncError("This device is already synced. Forget this device first to connect elsewhere.");
  if (sandboxOn()) throw new SyncError("Finish the sandbox (Keep or Discard) before setting up sync.");
  const settings = validateSettings(input);
  if (!(await transport.isReachable(settings))) {
    throw new SyncError(`${UNREACHABLE} Check the URL and your connection.`, 502);
  }

  const remote = transport.openRemote(settings);
  try {
    let facts: RemoteFacts;
    try {
      facts = await probe(remote);
    } catch (e) {
      throw new SyncError(`Could not read the cloud database: ${errorMessage(e)}`, 502);
    }
    const gate = schemaVersionGate(facts.schemaVersion);
    if (gate) throw new SyncError(gate, 409, "SCHEMA_NEWER", facts);
    if (!facts.empty && input.source !== "local" && input.source !== "cloud") {
      throw new SyncError(
        `The cloud database already holds data (${facts.dataRows} rows). Choose which side to keep.`,
        409,
        "REMOTE_HAS_DATA",
        facts,
      );
    }
    if (facts.empty || input.source === "local") {
      try {
        await replaceRemote(remote, await dumpDatabase(storeExecutor()));
      } catch (e) {
        throw new SyncError(`Uploading this device's data failed: ${errorMessage(e)}`, 502);
      }
    }
  } finally {
    remote.close();
  }

  // The local file is left exactly as it was — it is the "before sync" copy.
  state.settings = settings;
  state.lastError = null;
  state.schemaGate = null;
  await removeReplicaFiles();
  await activateReplica();
  if (state.readOnly || state.lastError) {
    // The cloud answered a moment ago but the replica could not be opened:
    // undo everything, the device stays local only.
    const reason = state.lastError ?? "unknown error";
    await switchDatabase(getRealDatabaseUrl());
    setPrimaryDatabase(getRealDatabaseUrl());
    await removeReplicaFiles();
    state.settings = null;
    state.readOnly = false;
    state.lastError = null;
    throw new SyncError(`Could not open the replica: ${reason}`, 502);
  }
  saveSyncSettings(settings);
  startTimer();
  console.log(`[Sync] connected to ${settings.url}`);
  return getSyncStatus();
}

/** "Sync now": reconnect if needed, then pull. Cloud problems come back as a 502 and in the status. */
export async function syncNow(): Promise<SyncStatus> {
  if (!state.settings) throw new SyncError("Sync is not set up on this device.");
  if (state.pausedBy) throw new SyncError("Sync is paused while the sandbox is active.");
  if (state.schemaGate) throw new SyncError(schemaVersionGate(state.schemaGate.database)!, 409, "SCHEMA_NEWER");
  if (state.syncing) return getSyncStatus();
  if (!(await reachableNow(state.settings))) {
    state.lastError = UNREACHABLE;
    throw new SyncError(state.lastError, 502);
  }
  try {
    if (state.readOnly) await activateReplica();
    else await pullFromCloud();
  } catch (e) {
    throw new SyncError(`Sync failed: ${errorMessage(e)}`, 502);
  }
  if (state.readOnly) throw new SyncError(`Sync failed: ${state.lastError ?? "could not open the replica"}`, 502);
  return getSyncStatus();
}

/**
 * "Forget this device": back to local only. The replica's data becomes the
 * local file (a timestamped .bak of the old local file is written first),
 * the replica files are deleted and the token is gone.
 */
export async function disconnectSync(): Promise<SyncStatus & { backupPath: string | null }> {
  if (!state.settings) throw new SyncError("Sync is not set up on this device.");
  if (state.pausedBy) throw new SyncError("Finish the sandbox (Keep or Discard) before forgetting this device.");
  stopTimer();

  const real = realDbPath();
  const onReplica = getCurrentTarget().url !== getRealDatabaseUrl();
  let backupPath: string | null = null;
  if (onReplica) {
    const dump = await dumpDatabase(storeExecutor());
    backupPath = backupFilePath();
    await switchDatabase(getRealDatabaseUrl(), () => {
      if (fs.existsSync(real)) fs.copyFileSync(real, backupPath!);
    });
    await loadDatabase(storeExecutor(), dump);
  } else {
    // Read-only fallback on the local file itself: nothing to carry over.
    await switchDatabase(getRealDatabaseUrl());
  }
  setPrimaryDatabase(getRealDatabaseUrl());
  await removeReplicaFiles();
  clearSyncSettings();
  Object.assign(state, {
    settings: null,
    syncing: false,
    lastSyncedAt: null,
    lastError: null,
    schemaGate: null,
    readOnly: false,
  });
  console.log("[Sync] disconnected — back to the local database");
  return { ...getSyncStatus(), backupPath };
}

// ── Sandbox hooks (main/sandbox.ts) ─────────────────────────────────────────

/** Write the current database's rows into a brand-new plain SQLite file. */
async function writePlainCopy(targetPath: string, dump: DatabaseDump): Promise<void> {
  fs.rmSync(targetPath, { force: true });
  const conn = openLibsql(targetPath);
  try {
    await loadDatabase(conn, dump);
  } finally {
    await conn.close();
  }
}

/**
 * Sandbox enter while synced: the replica's rows go into the plain sandbox
 * file (its WAL may hold frames a file copy would miss), the API moves to
 * that file and sync pauses.
 */
export async function pauseSyncForSandbox(sandboxPath: string): Promise<void> {
  if (!state.settings) throw new SyncError("Sync is not set up on this device.");
  await writePlainCopy(sandboxPath, await dumpDatabase(storeExecutor()));
  await switchDatabase(pathToDatabaseUrl(sandboxPath));
  state.pausedBy = "sandbox";
}

/** Sandbox discard while synced: back on the replica. */
export async function resumeSyncAfterSandbox(): Promise<void> {
  if (!state.settings) throw new SyncError("Sync is not set up on this device.");
  await activateReplica();
  state.pausedBy = null;
}

/**
 * Sandbox keep while synced: a .bak of the cloud's current rows (read from
 * the closed replica file), then the sandbox's rows replace the cloud's, then
 * back on the replica, which pulls them. Needs the cloud: when it is
 * unreachable the sandbox stays active and the caller gets a 502 to retry.
 */
export async function keepSandboxToSync(sandboxPath: string, backupPath: string): Promise<void> {
  if (!state.settings) throw new SyncError("Sync is not set up on this device.");
  if (!(await reachableNow(state.settings))) {
    throw new SyncError("Keep needs the cloud database, which can't be reached right now. Try again when you're online.", 502);
  }
  // Backup of what the cloud holds now, from the replica file (closed while the sandbox is on).
  if (fs.existsSync(replicaDbPath())) {
    const replica = openLibsql(replicaDbPath(), { readOnly: true });
    try {
      await writePlainCopy(backupPath, await dumpDatabase(replica));
    } finally {
      await replica.close();
    }
  }
  const dump = await dumpDatabase(storeExecutor());
  const remote = transport.openRemote(state.settings);
  try {
    await replaceRemote(remote, dump);
  } catch (e) {
    throw new SyncError(`Pushing the kept data to the cloud failed: ${errorMessage(e)}`, 502);
  } finally {
    remote.close();
  }
  await activateReplica();
  state.pausedBy = null;
}

// ── Snapshots, export, import ───────────────────────────────────────────────

/** `<real database>.<stamp>.bak` — the naming scripts/db-sync.cjs, Sandbox Keep and Backups share. */
export function backupFilePath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${realDbPath()}.${stamp}.bak`;
}

/**
 * A consistent plain-SQLite copy of whatever the API is on right now. A
 * plain local file gets SQLite's `VACUUM INTO` (byte-faithful), a replica
 * gets a dump through the data layer (its WAL and libsql side files make a
 * file copy unreliable, and VACUUM would be forwarded to the cloud).
 */
export async function snapshotCurrentDatabase(targetPath: string): Promise<"vacuum" | "copy" | "dump"> {
  const target = getCurrentTarget();
  if (target.sync || target.readOnly) {
    await writePlainCopy(targetPath, await dumpDatabase(storeExecutor()));
    return "dump";
  }
  try {
    const quoted = targetPath.replace(/\\/g, "/").replace(/'/g, "''");
    await getStore().raw(`VACUUM INTO '${quoted}'`);
    return "vacuum";
  } catch (err) {
    console.warn("VACUUM INTO failed, copying the file instead:", err);
    fs.copyFileSync(path.normalize(databaseUrlToPath(target.url)), targetPath);
    return "copy";
  }
}

/** Export: a plain SQLite file of the current data, written to `targetPath`. */
export async function exportDatabase(targetPath: string): Promise<void> {
  if (sandboxOn()) throw new SyncError("Finish the sandbox (Keep or Discard) before exporting.");
  await snapshotCurrentDatabase(targetPath);
}

export interface ImportResult {
  dataRows: number;
  schemaVersion: number;
  backupPath: string;
  /** Where the rows went: the local file, or the cloud (and from there the replica). */
  target: "local" | "cloud";
}

/**
 * Import: the rows of a SQLite file (an export, a .bak, a database.db)
 * replace the current data. Local only → into the real file; synced → pushed
 * to the cloud and pulled back into the replica. A .bak of the current data
 * is written first. The file is validated (SQLite header, schema version not
 * newer than this app's) before anything is touched.
 */
export async function importDatabase(filePath: string): Promise<ImportResult> {
  if (sandboxOn()) throw new SyncError("Finish the sandbox (Keep or Discard) before importing.");
  if (state.schemaGate) throw new SyncError(schemaVersionGate(state.schemaGate.database)!, 409, "SCHEMA_NEWER");
  const header = Buffer.alloc(16);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, header, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (!header.toString("utf8", 0, 15).startsWith("SQLite format 3")) {
    throw new SyncError("That file is not a SQLite database.", 400);
  }
  const source = openLibsql(filePath, { readOnly: true });
  let dump: DatabaseDump;
  try {
    if (await hasNoTables(source)) throw new SyncError("That database has no tables.", 400);
    dump = await dumpDatabase(source);
  } catch (e) {
    if (e instanceof SyncError) throw e;
    throw new SyncError(`Could not read that database: ${errorMessage(e)}`, 400);
  } finally {
    await source.close();
  }
  const gate = schemaVersionGate(dump.schemaVersion);
  if (gate) throw new SyncError(gate, 409, "SCHEMA_NEWER");

  const backupPath = backupFilePath();
  await snapshotCurrentDatabase(backupPath);

  if (state.settings) {
    if (!(await reachableNow(state.settings))) {
      throw new SyncError("Importing while synced needs the cloud database, which can't be reached right now.", 502);
    }
    const remote = transport.openRemote(state.settings);
    try {
      await replaceRemote(remote, dump);
    } catch (e) {
      throw new SyncError(`Pushing the imported data to the cloud failed: ${errorMessage(e)}`, 502);
    } finally {
      remote.close();
    }
    if (state.readOnly) await activateReplica();
    else await pullFromCloud();
    return { dataRows: countDataRows(dump), schemaVersion: dump.schemaVersion, backupPath, target: "cloud" };
  }

  await loadDatabase(storeExecutor(), dump);
  return { dataRows: countDataRows(dump), schemaVersion: dump.schemaVersion, backupPath, target: "local" };
}
