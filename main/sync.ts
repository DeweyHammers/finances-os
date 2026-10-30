/**
 * sync.ts — Phase B of plans/phone-app-and-sync.md: the desktop keeps a
 * local copy of a cloud libsql/Turso database the user owns and syncs it in
 * the background. LOCAL-FIRST since Oct 29 2026.
 *
 *   Local only (default)   the API is on the real local file, as always.
 *   Synced                 the API is on replica.db beside it, opened as a
 *                          libsql SYNCED DATABASE (offline writes; shared/
 *                          data/backends/libsql.ts): every read and write is
 *                          a plain local operation, exactly as fast as the
 *                          local-only app; `sync()` pushes the writes to the
 *                          cloud and pulls what other devices pushed. It
 *                          runs 3 s after a write, every minute, on "Sync
 *                          now", at startup and at connect.
 *
 * Until Oct 29 2026 the replica was libsql's REMOTE replica: every write was
 * forwarded to the cloud before the API answered (1–3 s per save, more after
 * a quiet spell because a reachability probe ran first), and the device was
 * read-only while the cloud was unreachable. The user reversed that after a
 * day of use: local-database speed first, sync in the background.
 *
 * What the new model costs: two devices can now change the same database
 * while apart. libsql does not merge — a push that doesn't continue the
 * cloud's frame log is refused — so the status gets a `conflict` state and
 * the user chooses: "use the cloud's copy" (this device's unpushed changes
 * go into a .bak and the local copy is fetched again) or "keep this
 * device's changes" (the cloud's rows go into a .bak, then the cloud is
 * replaced with this device's rows). Nothing is merged or guessed, nothing
 * is lost silently.
 *
 * Offline: the app keeps working read-write on the local copy; the status
 * says `offline` with the number of changes waiting; the next successful
 * sync pushes them. A write can never hang on the network any more. The one
 * exception is a device whose local copy is MISSING while the cloud can't
 * be reached (nothing to open): the pre-sync local file is shown read-only
 * until the cloud is back.
 *
 * Switching local → synced uploads the local database once (or, when the
 * cloud already holds data, the user chooses which side wins); switching
 * back ("Forget this device") writes the local copy's data into the local
 * file so nothing is lost and no token stays behind. Export / Import work in
 * both modes through the data layer's dump/load (shared/data/transfer.ts).
 *
 * Schema-version gate: a database stamped by a NEWER app (SchemaVersion >
 * this build's SCHEMA_VERSION) is neither synced nor written; the status
 * says "update the app on this device".
 *
 * Sandbox: entering one dumps the local copy into the plain sandbox file and
 * pauses sync; Discard reopens the copy; Keep pushes the sandbox's rows to
 * the cloud and fetches the copy again (main/sandbox.ts calls in here).
 *
 * No Electron imports (sync-settings.ts isolates safeStorage), so this runs
 * in the app, the demo server and the tests alike. The tests run the REAL
 * libsql client against a protocol-faithful mock of the cloud
 * (tests/helpers/libsql-sync-server.ts); only Turso Cloud serves the
 * offline-writes protocol, the open-source libsql-server does not.
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
import { collectGarbage, isSyncConflictError, openLibsql } from "../shared/data/backends/libsql";
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
/** How often the local copy syncs while idle. */
export const SYNC_INTERVAL_MS = 60_000;
/** Pause after a local write before the push (more writes usually follow). */
export const SYNC_AFTER_WRITE_MS = 3_000;
/**
 * A sync that takes longer than this is given up (the store's lock is held
 * meanwhile, so a black-holed host must not hold it forever). libsql has no
 * timeout of its own; a host that refuses the connection fails in ~1 ms.
 */
export const SYNC_TIMEOUT_MS = 30_000;
const REACHABILITY_TIMEOUT_MS = 8_000;
const UNREACHABLE = "The cloud database can't be reached.";
/** Statements per cloud batch (= per transaction) when pushing a whole database. */
const BATCH_SIZE = 200;
/** libsql's WAL frame = 24-byte header + 4096-byte page; the WAL file starts with a 32-byte header. */
const WAL_FRAME_BYTES = 4120;
const WAL_HEADER_BYTES = 32;

// ── Public types ────────────────────────────────────────────────────────────

export type SyncState = "local" | "synced" | "syncing" | "offline" | "paused" | "blocked" | "conflict";

export interface SyncConflict {
  /** libsql's error, for the log; the UI has its own words. */
  message: string;
  since: string;
}

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
  /**
   * The local copy is missing and the cloud can't be reached to fetch it:
   * the data from before sync was set up is shown read-only until it is.
   */
  readOnly: boolean;
  /** Why writes are refused right now (schema gate, the read-only corner), null when they are allowed. */
  writesBlocked: string | null;
  /**
   * Changes saved on this device that have not reached the cloud yet: the
   * writes since the last push in this run, or — right after a start — the
   * WAL frames the previous run left unpushed. 0 once a push succeeds.
   */
  pendingChanges: number;
  pendingPush: boolean;
  /** The cloud moved on while this device had unpushed changes; the user must choose. */
  conflict: SyncConflict | null;
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

// ── Transport (the only part that touches the network directly) ─────────────

export interface RemoteDatabase extends SqlExecutor {
  /** Run statements in order inside one transaction. */
  batch(statements: Statement[]): Promise<void>;
  close(): void;
}

export interface SyncTransport {
  /** A direct connection to the cloud database (probe, first upload, pushes of whole databases). */
  openRemote(settings: SyncSettings): RemoteDatabase;
  /** Can the cloud be reached right now? Must never block the process. */
  isReachable(settings: SyncSettings): Promise<boolean>;
}

/** `libsql://host` → `https://host`; trailing slashes dropped. */
export function toHttpUrl(url: string): string {
  return url.trim().replace(/^libsql:\/\//i, "https://").replace(/\/+$/, "");
}

/** The URL forms Turso hands out, plus http for a local server. */
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
    // Any HTTP answer counts (a 401/404 still proves the host is up); only a
    // network failure or timeout is "offline". A cold TLS round trip to
    // Turso's edge measured 2.4 s (Oct 2026), so the timeout is generous,
    // and a failed /health gets a second chance through a real `select 1`.
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

let syncTimeoutMs = SYNC_TIMEOUT_MS;

export function __setSyncTimeoutForTests(ms: number | null): void {
  syncTimeoutMs = ms ?? SYNC_TIMEOUT_MS;
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
  /** The last sync could not reach the cloud (or failed on the way). */
  offline: boolean;
  conflict: SyncConflict | null;
  pendingChanges: number;
}

const INITIAL: State = {
  settings: null,
  syncing: false,
  lastSyncedAt: null,
  lastError: null,
  pausedBy: null,
  schemaGate: null,
  readOnly: false,
  offline: false,
  conflict: null,
  pendingChanges: 0,
};

const state: State = { ...INITIAL };

let timer: NodeJS.Timeout | null = null;
let afterWriteTimer: NodeJS.Timeout | null = null;

/**
 * Is the cloud reachable? Used before the direct-to-cloud work (first
 * upload, Keep, Import, "keep this device's changes") and before a bootstrap,
 * never before a write: writes are local now.
 */
async function reachableNow(settings: SyncSettings): Promise<boolean> {
  const reachable = await transport.isReachable(settings);
  if (reachable && state.lastError === UNREACHABLE) state.lastError = null;
  return reachable;
}

function realDbPath(): string {
  return path.normalize(databaseUrlToPath(getRealDatabaseUrl()));
}

/** `replica.db` beside the real database. */
export function replicaDbPath(): string {
  return path.join(path.dirname(realDbPath()), REPLICA_FILENAME);
}

/** Both files libsql needs to open the copy without the network. */
function replicaFilesPresent(): boolean {
  return fs.existsSync(replicaDbPath()) && fs.existsSync(`${replicaDbPath()}-info`);
}

/**
 * `replica.db-mode` says which libsql mode wrote the copy. The remote
 * replica (until Oct 29 2026) left the same `-info` metadata file behind,
 * with frame numbers from its own replication protocol; a copy without this
 * marker is therefore backed up and fetched again rather than trusted. The
 * old mode never held unpushed changes, so nothing can be lost.
 */
const REPLICA_MODE = "offline-writes";
function replicaModePath(): string {
  return `${replicaDbPath()}-mode`;
}
function replicaWrittenByThisMode(): boolean {
  try {
    return fs.readFileSync(replicaModePath(), "utf8").trim() === REPLICA_MODE;
  } catch {
    return false;
  }
}

/**
 * WAL frames the local copy holds beyond what the cloud has, from libsql's
 * own bookkeeping: `replica.db-info` records the last pushed frame, the WAL
 * file holds every frame since the last generation change. An estimate
 * (a rolled-back transaction leaves frames behind until overwritten) that is
 * only used to seed `pendingChanges` after a start; the first push resets it.
 */
function unpushedFramesEstimate(): number {
  try {
    const info = JSON.parse(fs.readFileSync(`${replicaDbPath()}-info`, "utf8")) as { durable_frame_num?: number };
    const walBytes = fs.existsSync(`${replicaDbPath()}-wal`) ? fs.statSync(`${replicaDbPath()}-wal`).size : 0;
    const frames = Math.max(0, Math.floor((walBytes - WAL_HEADER_BYTES) / WAL_FRAME_BYTES));
    return Math.max(0, frames - Number(info.durable_frame_num ?? 0));
  } catch {
    return 0;
  }
}

/** The store as a plain executor (dump/load read through it, statement by statement). */
function storeExecutor(): SqlExecutor {
  return { exec: (sql, params = []) => getStore().raw(sql, params) };
}

function replicaTarget(settings: SyncSettings): DatabaseTarget {
  return {
    url: pathToDatabaseUrl(replicaDbPath()),
    sync: { syncUrl: toHttpUrl(settings.url), authToken: settings.authToken, offline: true },
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
 * Delete the local copy and libsql's side files (`replica.db-wal`, `-shm`,
 * `-info`, …). Windows reports EBUSY/EPERM for a short while after a close,
 * so retry briefly (same as main/sandbox.ts).
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
        // The native handle goes when its JS wrapper is finalised, which
        // takes a GC plus a tick plus a few ms (measured Oct 2026).
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

/**
 * Why a write must be refused right now (main/api-server.ts), or null.
 * Synchronous and cheap: writes are local, so the only reasons left are the
 * schema gate and the read-only corner (no local copy, cloud unreachable).
 */
export function writeBlockReason(): string | null {
  if (!state.settings) return null;
  if (state.schemaGate) return schemaVersionGate(state.schemaGate.database);
  if (state.readOnly && !state.pausedBy) {
    return "This PC has no local copy of your cloud database yet and the cloud can't be reached to fetch it. The data from before sync was set up is shown read-only until it is back.";
  }
  return null;
}

export function getSyncStatus(): SyncStatus {
  const configured = isSyncConfigured();
  let syncState: SyncState = "local";
  if (configured) {
    if (state.pausedBy) syncState = "paused";
    else if (state.schemaGate) syncState = "blocked";
    else if (state.conflict) syncState = "conflict";
    else if (state.syncing) syncState = "syncing";
    else if (state.readOnly || state.offline) syncState = "offline";
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
    pendingChanges: configured ? state.pendingChanges : 0,
    pendingPush: configured && state.pendingChanges > 0,
    conflict: state.conflict,
    replicaPath: configured ? replicaDbPath() : null,
    appSchemaVersion: SCHEMA_VERSION,
  };
}

// ── The sync itself ─────────────────────────────────────────────────────────

/** Read the copy's schema stamp and raise the gate if it is newer than ours. */
async function checkSchemaGate(): Promise<void> {
  const version = await getSchemaVersion(storeExecutor());
  state.schemaGate = version > SCHEMA_VERSION ? { app: SCHEMA_VERSION, database: version } : null;
}

/**
 * One sync: push this device's frames, pull the others'. Records the outcome
 * in the status — offline (libsql reports 0 frames when the cloud can't be
 * reached), conflict (the cloud moved on while this device had unpushed
 * changes), or synced — and rethrows failures for callers that answer HTTP.
 */
async function runSync(): Promise<void> {
  if (!state.settings) throw new SyncError("Sync is not set up on this device.");
  state.syncing = true;
  try {
    const { framesSynced } = await getStore().sync({ timeoutMs: syncTimeoutMs });
    if (framesSynced === 0) {
      state.offline = true;
      state.lastError = UNREACHABLE;
      return;
    }
    state.offline = false;
    state.lastError = null;
    state.lastSyncedAt = new Date().toISOString();
    state.pendingChanges = 0;
    state.conflict = null;
    await checkSchemaGate();
  } catch (e) {
    if (isSyncConflictError(e)) {
      state.conflict ??= { message: errorMessage(e), since: new Date().toISOString() };
      state.lastError = "The cloud database changed while this PC had unsaved changes for it. Choose which side to keep in Settings → Phone & sync.";
    } else {
      state.offline = true;
      state.lastError = errorMessage(e);
    }
    throw e;
  } finally {
    state.syncing = false;
  }
}

/** Point the API at the pre-sync local file, read-only, until the cloud can be reached. */
async function fallBackReadOnly(beforeConnect?: () => void): Promise<void> {
  state.readOnly = true;
  state.offline = true;
  state.lastError = `${UNREACHABLE} There is no local copy of it on this PC yet, so the data from before sync was set up is shown read-only.`;
  await switchDatabase({ url: getRealDatabaseUrl(), readOnly: true }, beforeConnect);
}

/**
 * Put the API on the local copy. With the copy's files present this needs no
 * network (libsql opens them as they are); without them libsql bootstraps the
 * copy from the cloud, which needs it. Ends with one sync (push whatever the
 * previous run left, pull the cloud's news), whose outcome is in the status.
 * `beforeConnect` runs once, after the current store has closed (same
 * contract as switchDatabase). Never throws for a network problem — the
 * status carries it.
 */
async function activateReplica(beforeConnect?: () => void): Promise<void> {
  const settings = state.settings;
  if (!settings) throw new SyncError("Sync is not set up on this device.");
  const target = replicaTarget(settings);
  setPrimaryDatabase(target);
  let fresh = !replicaFilesPresent();

  if (!fresh && !replicaWrittenByThisMode()) {
    // A copy left by the remote-replica mode (or by a crash before the
    // marker was written): keep its rows as a .bak and fetch it again.
    console.log("[Sync] the local copy was not written by this sync mode; fetching it again");
    await getStore().close();
    await backupReplicaFile();
    await removeReplicaFiles();
    fresh = true;
  }

  if (fresh && !(await reachableNow(settings))) {
    await fallBackReadOnly(beforeConnect);
    return;
  }

  await switchDatabase(target, beforeConnect);
  try {
    await getCurrentConnection().open();
  } catch (e) {
    const reason = errorMessage(e);
    console.error("[Sync] could not open the local copy:", reason);
    await getStore().close();
    if (fresh) {
      // The bootstrap itself failed (the cloud went away, a server error).
      await removeReplicaFiles();
      state.lastError = reason;
      await fallBackReadOnly();
      return;
    }
    // The files are there but libsql won't open them — one of the pair
    // missing (InvalidLocalState), a damaged `-info` file, a copy from
    // another libsql version. With both files present libsql used no
    // network, so this is always a local-state problem: keep whatever the
    // copy holds as a .bak, then start over from the cloud.
    await backupReplicaFile();
    await removeReplicaFiles();
    if (!(await reachableNow(settings))) {
      await fallBackReadOnly();
      return;
    }
    await switchDatabase(target);
    try {
      await getCurrentConnection().open();
    } catch (e2) {
      await getStore().close();
      await removeReplicaFiles();
      state.lastError = errorMessage(e2);
      await fallBackReadOnly();
      return;
    }
    fresh = true;
  }

  try {
    fs.writeFileSync(replicaModePath(), `${REPLICA_MODE}\n`, "utf8");
  } catch (e) {
    console.warn("[Sync] could not write the mode marker:", errorMessage(e));
  }
  state.readOnly = false;
  state.pendingChanges = Math.max(state.pendingChanges, unpushedFramesEstimate());
  try {
    await runSync();
  } catch (e) {
    console.warn("[Sync] first sync after open failed:", errorMessage(e));
  }
  if (fresh && (state.offline || state.conflict)) {
    // A copy bootstrapped a moment ago that can't complete its first pull
    // may hold the cloud's base snapshot without the tables; using it would
    // create them locally and clash with the cloud. Start over next time.
    await getStore().close();
    await removeReplicaFiles();
    state.conflict = null;
    await fallBackReadOnly();
  }
}

/** Copy the closed local copy's rows into a fresh `.bak` (best effort). */
async function backupReplicaFile(): Promise<string | null> {
  if (!fs.existsSync(replicaDbPath())) return null;
  try {
    const replica = openLibsql(replicaDbPath(), { readOnly: true });
    try {
      const backupPath = backupFilePath();
      await writePlainCopy(backupPath, await dumpDatabase(replica));
      return backupPath;
    } finally {
      await replica.close();
    }
  } catch (e) {
    console.warn("[Sync] could not back up the local copy:", errorMessage(e));
    return null;
  }
}

/** Throw the local copy away and fetch it again from the cloud (the cloud is the truth now). */
async function rebootstrapReplica(): Promise<void> {
  await getStore().close();
  await removeReplicaFiles();
  state.conflict = null;
  state.pendingChanges = 0;
  await activateReplica();
}

/** One idle-time sync attempt. */
async function tick(): Promise<void> {
  if (!state.settings || state.pausedBy || state.schemaGate || state.conflict || state.syncing) return;
  try {
    if (state.readOnly) {
      if (await reachableNow(state.settings)) await activateReplica();
    } else {
      await runSync();
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

/** A route wrote something: count it as pending and push shortly (more writes usually follow). */
export function noteLocalWrite(): void {
  if (!state.settings || state.pausedBy) return;
  state.pendingChanges += 1;
  if (afterWriteTimer) clearTimeout(afterWriteTimer);
  afterWriteTimer = setTimeout(() => {
    afterWriteTimer = null;
    void tick();
  }, SYNC_AFTER_WRITE_MS);
  afterWriteTimer.unref?.();
}

/**
 * Startup: read the saved settings and, when synced, open the local copy
 * before the API starts serving. Called once by main.ts (after
 * app.whenReady, which safeStorage needs) and by the tests.
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
    console.log(`[Sync] synced with ${state.settings.url} (${getSyncStatus().state}, ${state.pendingChanges} pending)`);
  }
  return getSyncStatus();
}

/**
 * Back to the pristine local-only in-memory state (tests only). `keepFiles`
 * leaves sync.json and the local copy on disk, to play a restart.
 */
export async function __resetSyncForTests(options: { keepFiles?: boolean } = {}): Promise<void> {
  stopTimer();
  if (state.settings || getCurrentTarget().url !== getRealDatabaseUrl()) {
    await switchDatabase(getRealDatabaseUrl());
    setPrimaryDatabase(getRealDatabaseUrl());
  }
  if (!options.keepFiles) {
    await removeReplicaFiles();
    clearSyncSettings();
  }
  Object.assign(state, INITIAL);
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
  Object.assign(state, INITIAL, { settings });
  await removeReplicaFiles();
  await activateReplica();
  if (state.readOnly || state.offline || state.conflict) {
    // The cloud answered a moment ago but the copy could not be fetched:
    // undo everything, the device stays local only.
    const reason = state.lastError ?? "unknown error";
    await switchDatabase(getRealDatabaseUrl());
    setPrimaryDatabase(getRealDatabaseUrl());
    await removeReplicaFiles();
    Object.assign(state, INITIAL);
    throw new SyncError(`Could not fetch the local copy of the cloud database: ${reason}`, 502);
  }
  saveSyncSettings(settings);
  startTimer();
  console.log(`[Sync] connected to ${settings.url}`);
  return getSyncStatus();
}

/** "Sync now": push + pull. Cloud problems come back as a 502 and in the status; a conflict as 409. */
export async function syncNow(): Promise<SyncStatus> {
  if (!state.settings) throw new SyncError("Sync is not set up on this device.");
  if (state.pausedBy) throw new SyncError("Sync is paused while the sandbox is active.");
  if (state.schemaGate) throw new SyncError(schemaVersionGate(state.schemaGate.database)!, 409, "SCHEMA_NEWER");
  if (state.conflict) throw new SyncError(state.lastError ?? "Sync conflict.", 409, "SYNC_CONFLICT", state.conflict);
  if (state.syncing) return getSyncStatus();
  try {
    if (state.readOnly) {
      if (!(await reachableNow(state.settings))) throw new SyncError(UNREACHABLE, 502);
      await activateReplica();
      if (state.readOnly) throw new SyncError(`Sync failed: ${state.lastError ?? "could not fetch the local copy"}`, 502);
    } else {
      await runSync();
    }
  } catch (e) {
    if (e instanceof SyncError) throw e;
    if (state.conflict) throw new SyncError(state.lastError ?? "Sync conflict.", 409, "SYNC_CONFLICT", state.conflict);
    throw new SyncError(`Sync failed: ${errorMessage(e)}`, 502);
  }
  if (state.offline) throw new SyncError(UNREACHABLE, 502);
  return getSyncStatus();
}

/**
 * Settle a conflict. "cloud": this device's rows (unpushed changes included)
 * go into a .bak, then the local copy is fetched again from the cloud.
 * "local": the cloud's rows go into a .bak, then the cloud is replaced with
 * this device's rows and the local copy is fetched again (so the two agree
 * frame for frame). Needs the cloud either way.
 */
export async function resolveConflict(keep: "cloud" | "local"): Promise<SyncStatus & { backupPath: string }> {
  if (!state.settings) throw new SyncError("Sync is not set up on this device.");
  if (state.pausedBy) throw new SyncError("Finish the sandbox (Keep or Discard) first.");
  if (!state.conflict) throw new SyncError("There is no sync conflict to settle.", 409, "NO_CONFLICT");
  if (keep !== "cloud" && keep !== "local") throw new SyncError('Say which side to keep: "cloud" or "local".', 400);
  if (!(await reachableNow(state.settings))) {
    throw new SyncError("Settling the conflict needs the cloud database, which can't be reached right now.", 502);
  }
  const backupPath = backupFilePath();
  if (keep === "cloud") {
    await writePlainCopy(backupPath, await dumpDatabase(storeExecutor()));
    await rebootstrapReplica();
  } else {
    const remote = transport.openRemote(state.settings);
    try {
      await writePlainCopy(backupPath, await dumpDatabase(remote));
      await replaceRemote(remote, await dumpDatabase(storeExecutor()));
    } catch (e) {
      throw new SyncError(`Pushing this device's data to the cloud failed: ${errorMessage(e)}`, 502);
    } finally {
      remote.close();
    }
    await rebootstrapReplica();
  }
  if (state.conflict || state.readOnly) {
    throw new SyncError(`Could not fetch the local copy after settling: ${state.lastError ?? "unknown error"}`, 502);
  }
  console.log(`[Sync] conflict settled, kept the ${keep} side; backup at ${backupPath}`);
  return { ...getSyncStatus(), backupPath };
}

/**
 * "Forget this device": back to local only. The local copy's data — unpushed
 * changes included — becomes the local file (a timestamped .bak of the old
 * local file is written first), the copy's files are deleted and the token
 * is gone.
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
  Object.assign(state, INITIAL);
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
 * Sandbox enter while synced: the local copy's rows go into the plain
 * sandbox file (its WAL may hold frames a file copy would miss), the API
 * moves to that file and sync pauses. Works offline.
 */
export async function pauseSyncForSandbox(sandboxPath: string): Promise<void> {
  if (!state.settings) throw new SyncError("Sync is not set up on this device.");
  await writePlainCopy(sandboxPath, await dumpDatabase(storeExecutor()));
  await switchDatabase(pathToDatabaseUrl(sandboxPath));
  state.pausedBy = "sandbox";
}

/** Sandbox discard while synced: back on the local copy (no network needed). */
export async function resumeSyncAfterSandbox(): Promise<void> {
  if (!state.settings) throw new SyncError("Sync is not set up on this device.");
  state.pausedBy = null;
  await activateReplica();
}

/**
 * Sandbox keep while synced: a .bak of this device's rows (read from the
 * closed copy — unpushed changes included), then the sandbox's rows replace
 * the cloud's, then the local copy is fetched again so it agrees with the
 * cloud frame for frame. Needs the cloud: when it is unreachable the sandbox
 * stays active and the caller gets a 502 to retry.
 */
export async function keepSandboxToSync(sandboxPath: string, backupPath: string): Promise<void> {
  if (!state.settings) throw new SyncError("Sync is not set up on this device.");
  if (!(await reachableNow(state.settings))) {
    throw new SyncError("Keep needs the cloud database, which can't be reached right now. Try again when you're online.", 502);
  }
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
  state.pausedBy = null;
  await rebootstrapReplica();
}

// ── Snapshots, export, import ───────────────────────────────────────────────

/** `<real database>.<stamp>.bak` — the naming scripts/db-sync.cjs, Sandbox Keep and Backups share. */
export function backupFilePath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${realDbPath()}.${stamp}.bak`;
}

/**
 * A consistent plain-SQLite copy of whatever the API is on right now. A
 * plain local file gets SQLite's `VACUUM INTO` (byte-faithful), a synced copy
 * gets a dump through the data layer (its WAL and libsql side files make a
 * file copy unreliable).
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
  /** Where the rows went: the local file, or the cloud (and from there the local copy). */
  target: "local" | "cloud";
}

/**
 * Import: the rows of a SQLite file (an export, a .bak, a database.db)
 * replace the current data. Local only → into the real file; synced → pushed
 * to the cloud and the local copy fetched again. A .bak of the current data
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
    await rebootstrapReplica();
    return { dataRows: countDataRows(dump), schemaVersion: dump.schemaVersion, backupPath, target: "cloud" };
  }

  await loadDatabase(storeExecutor(), dump);
  return { dataRows: countDataRows(dump), schemaVersion: dump.schemaVersion, backupPath, target: "local" };
}
