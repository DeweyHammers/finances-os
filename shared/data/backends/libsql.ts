/**
 * backends/libsql.ts — the desktop backend: a local SQLite file through the
 * `libsql` package (better-sqlite3-compatible, synchronous, no query engine),
 * either on its own or as an EMBEDDED REPLICA of a remote libsql/Turso
 * database (Phase B of plans/phone-app-and-sync.md).
 *
 * The file is opened lazily on the first statement (or eagerly via `open()`)
 * and released by `close()`; Sandbox mode relies on that to copy / overwrite /
 * delete database files while nothing holds them (shared/db.ts →
 * switchDatabase). Every connection turns foreign keys on (the schema's
 * ON DELETE CASCADE / SET NULL depend on it, as they did under Prisma) and
 * waits up to 5 s on a locked file instead of failing when another process
 * (a backup, a viewer) has it open.
 *
 * Replica mode (`sync` option) is libsql's remote replica: reads run on the
 * local file, every write is forwarded to the remote and — with read-your-
 * writes — is visible locally at once; `sync()` pulls what other devices
 * wrote. Chosen over libsql's experimental offline-writes mode on purpose:
 * one source of truth, nothing to merge, nothing to lose when two devices
 * disagree. The cost is that writes need the cloud: when it is unreachable
 * the open itself fails (libsql connects on open), and main/sync.ts then
 * opens the same file plain and READ-ONLY so the user still sees their data.
 */
import Database from "libsql";
import v8 from "v8";
import vm from "vm";
import type { Row, SqlConnection, SqlValue } from "../sql";

/** How to reach the remote this file is a replica of. */
export interface LibsqlSyncOptions {
  /** `libsql://…turso.io` or `https://…` (what Turso shows as the database URL). */
  syncUrl: string;
  authToken: string;
}

export interface LibsqlOpenOptions {
  /** Open as an embedded replica of this remote. */
  sync?: LibsqlSyncOptions;
  /** Refuse every write on this connection (`PRAGMA query_only`). */
  readOnly?: boolean;
}

export interface LibsqlConnection extends SqlConnection {
  /** Filesystem path of the database file. */
  readonly path: string;
  /** Opened with `sync` options: reads local, writes forwarded to the remote. */
  readonly replica: boolean;
  readonly readOnly: boolean;
  /** True while the file is open. */
  isOpen(): boolean;
  /**
   * Open now instead of on the first statement. For a replica this is the
   * moment libsql connects to the remote (and pulls the first frames), so it
   * is where "the cloud is unreachable" surfaces.
   */
  open(): Promise<void>;
  /** Pull the remote's latest frames. Rejects on a plain (non-replica) file. */
  sync(): Promise<void>;
}

/**
 * libsql (0.5.x) finalises a prepared statement only when its JS object is
 * garbage-collected, and the SQLite file handle stays open until the last
 * statement is gone — so right after `close()` Windows still reports EBUSY
 * on the file (verified Oct 2026: every statement kind, `.all()` included).
 * A full GC before closing collects the statements our `exec` dropped and
 * makes the release immediate. `gc` is not exposed by default; this is the
 * trick from Node's own v8.setFlagsFromString() docs. If it is unavailable
 * the close still happens — callers that delete files retry briefly
 * (main/sandbox.ts → removeSandboxFile).
 */
let gcFn: (() => void) | null | undefined;
export function collectGarbage(): boolean {
  const exposed = (globalThis as { gc?: () => void }).gc;
  if (typeof exposed === "function") {
    exposed();
    return true;
  }
  if (gcFn === undefined) {
    try {
      v8.setFlagsFromString("--expose-gc");
      gcFn = vm.runInNewContext("gc") as () => void;
    } catch {
      gcFn = null;
    }
  }
  if (!gcFn) return false;
  gcFn();
  return true;
}

/**
 * `sync()` without blocking the process.
 *
 * libsql's synchronous API runs `sync()` with `block_on` — the whole Electron
 * main process (and with it every API request) waits for the network round
 * trip. Its promise API (`libsql/promise`) has a non-blocking `sync()`, but in
 * 0.5.29 that API cannot OPEN a replica at all: its wrapper passes one
 * argument too few to the native `databaseOpenWithSync` ("failed to downcast
 * any to boolean", verified Oct 2026). The native addon is the same module for
 * both APIs, though, and its `databaseSyncAsync` runs on the tokio runtime,
 * so we open with the synchronous API and borrow that one function for the
 * sync. If the addon ever changes shape, `null` comes back and the blocking
 * `db.sync()` is used instead — main/sync.ts checks the remote is reachable
 * (asynchronously) before any blocking call, so a dead network never stalls
 * the app for long either way.
 */
type NativeSync = (this: unknown) => Promise<unknown>;
let nativeSync: NativeSync | null | undefined;
function loadNativeAsyncSync(): NativeSync | null {
  if (nativeSync !== undefined) return nativeSync;
  nativeSync = null;
  try {
    // Nextron bundles the main process with webpack; `__non_webpack_require__`
    // is the real Node require there, so the platform package resolves at
    // runtime from node_modules like `libsql` itself does.
    const req: NodeRequire =
      typeof (globalThis as any).__non_webpack_require__ === "function"
        ? (globalThis as any).__non_webpack_require__
        : require;
    const { currentTarget } = req("@neon-rs/load") as { currentTarget(): string };
    const native = req(`@libsql/${currentTarget()}`) as { databaseSyncAsync?: NativeSync };
    if (typeof native.databaseSyncAsync === "function") nativeSync = native.databaseSyncAsync;
  } catch {
    nativeSync = null;
  }
  return nativeSync;
}

export function openLibsql(filePath: string, options: LibsqlOpenOptions = {}): LibsqlConnection {
  let db: Database.Database | null = null;
  const replica = !!options.sync;
  const readOnly = !!options.readOnly;

  const ensure = (): Database.Database => {
    if (!db) {
      // `authToken` is accepted by libsql's constructor (index.js) though the
      // bundled better-sqlite3-style typings only list `syncUrl`.
      const next = options.sync
        ? new Database(filePath, { syncUrl: options.sync.syncUrl, authToken: options.sync.authToken } as any)
        : new Database(filePath);
      try {
        next.exec("PRAGMA foreign_keys = ON");
        // A replica connection accepts only the PRAGMAs libsql knows how to
        // classify: foreign_keys yes, busy_timeout no (Sqlite3UnsupportedStatement,
        // verified against libsql-server Oct 2026). The replica file is this
        // process's alone, so the wait isn't needed there anyway.
        if (!replica) next.exec("PRAGMA busy_timeout = 5000");
        // query_only makes SQLite itself reject INSERT/UPDATE/DELETE/DDL on this
        // connection, so a read-only fallback can never diverge from the cloud.
        // (Also unsupported on a replica; read-only is only ever a plain open.)
        if (readOnly) next.exec("PRAGMA query_only = 1");
      } catch (e) {
        // Never leak a half-configured handle: it would keep the file open
        // (and, for a replica, the cloud connection) with no way to close it.
        next.close();
        throw e;
      }
      db = next;
    }
    return db;
  };

  return {
    path: filePath,
    replica,
    readOnly,
    isOpen: () => db !== null,
    async open(): Promise<void> {
      ensure();
    },
    async exec(sql: string, params: SqlValue[] = []): Promise<Row[]> {
      // `.all()` steps every statement to completion (and resets it), even
      // for INSERT / UPDATE / BEGIN, which `.run()` does not — a half-stepped
      // statement is another way to keep the file handle alive.
      const rows = ensure().prepare(sql).all(...params) as Row[];
      return rows;
    },
    async sync(): Promise<void> {
      if (!replica) throw new Error(`${filePath} is not a replica; nothing to sync`);
      const handle = ensure();
      const asyncSync = loadNativeAsyncSync();
      // The native handle lives in `db.db` on the JS wrapper (libsql/index.js).
      const nativeHandle = (handle as unknown as { db: unknown }).db;
      if (asyncSync && nativeHandle) await asyncSync.call(nativeHandle);
      else handle.sync();
    },
    async close(): Promise<void> {
      if (!db) return;
      // The finalisers freed by the GC run on the NEXT macrotask (measured:
      // gc → close alone still leaves the handle open 20/20 times, gc → tick
      // → close releases it 20/20), hence the setImmediate between the two.
      collectGarbage();
      await new Promise<void>((resolve) => setImmediate(resolve));
      db.close();
      db = null;
      // `close()` drops the connection, but the native Database object — and
      // for a replica its replicator, which holds the file too — lives until
      // the JS wrapper is collected. One more GC + tick with the reference
      // gone releases the file at once (measured Oct 2026 against
      // libsql-server: EPERM before, deletable after).
      collectGarbage();
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
}
