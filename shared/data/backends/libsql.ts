/**
 * backends/libsql.ts — the desktop backend: a local SQLite file through the
 * `libsql` package (better-sqlite3-compatible, synchronous, no query engine),
 * either on its own or as a SYNCED DATABASE of a remote libsql/Turso database
 * (Phase B of plans/phone-app-and-sync.md, local-first since Oct 29 2026).
 *
 * The file is opened lazily on the first statement (or eagerly via `open()`)
 * and released by `close()`; Sandbox mode relies on that to copy / overwrite /
 * delete database files while nothing holds them (shared/db.ts →
 * switchDatabase). Every connection turns foreign keys on (the schema's
 * ON DELETE CASCADE / SET NULL depend on it, as they did under Prisma) and
 * waits up to 5 s on a locked file instead of failing when another process
 * (a backup, a viewer) has it open.
 *
 * Synced mode (`sync` option with `offline: true`) is libsql's offline-writes
 * / "synced database" mode (`new Database(path, { syncUrl, authToken,
 * offline: true })`, libsql 0.9.30 → src/sync.rs): every read AND write is a
 * plain local WAL operation — as fast as the local-only app — and `sync()`
 * pushes the WAL frames written since the last push, then pulls the frames
 * other devices pushed. It replaced libsql's remote replica (writes forwarded
 * to the cloud, 1–3 s per save) on Oct 29 2026. What libsql does, verified
 * against a protocol-faithful mock (tests/helpers/libsql-sync-server.ts):
 *   - OPEN needs the network only when the file (and its `-info` metadata
 *     file beside it) does not exist yet: it bootstraps from the cloud's
 *     `/export`. With both files present it opens with no network at all.
 *   - A write never touches the network, even while a sync is stuck.
 *   - `sync()` resolves with `framesSynced: 0` when the cloud can't be
 *     reached (libsql folds a network failure into "nothing synced"); it
 *     REJECTS with `InvalidPushFrameConflict` / `InvalidPushFrameNoHigh` when
 *     the cloud moved on while this file had unpushed frames — that is the
 *     conflict main/sync.ts turns into its `conflict` state.
 *   - `PRAGMA busy_timeout` works here (a remote replica rejected it);
 *     `foreign_keys` too. The local WAL is only checkpointed when the cloud
 *     starts a new generation (libsql disables ordinary checkpoints), so it
 *     grows between generations.
 * `offline: false` still opens the old remote replica (nothing uses it).
 */
import Database from "libsql";
import v8 from "v8";
import vm from "vm";
import type { Row, SqlConnection, SqlValue, SyncOptions, SyncResult } from "../sql";

/** How to reach the remote this file is synced with. */
export interface LibsqlSyncOptions {
  /** `libsql://…turso.io` or `https://…` (what Turso shows as the database URL). */
  syncUrl: string;
  authToken: string;
  /**
   * true = synced database (local writes, pushed by `sync()`; the mode the
   * app uses). false = remote replica (writes forwarded to the cloud).
   */
  offline?: boolean;
}

export interface LibsqlOpenOptions {
  /** Open as a synced database / replica of this remote. */
  sync?: LibsqlSyncOptions;
  /** Refuse every write on this connection (`PRAGMA query_only`). */
  readOnly?: boolean;
}

export interface LibsqlConnection extends SqlConnection {
  /** Filesystem path of the database file. */
  readonly path: string;
  /** Opened with `sync` options. */
  readonly replica: boolean;
  /** Opened with `sync.offline`: writes are local, `sync()` pushes them. */
  readonly offline: boolean;
  readonly readOnly: boolean;
  /** True while the file is open. */
  isOpen(): boolean;
  /**
   * Open now instead of on the first statement. For a synced database with
   * no local file yet this is the moment libsql bootstraps it from the
   * cloud, so it is where "the cloud is unreachable" surfaces; with the
   * file present it needs no network.
   */
  open(): Promise<void>;
  /** Push local frames, pull the remote's. Rejects on a plain (non-synced) file. */
  sync(options?: SyncOptions): Promise<SyncResult>;
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
 * sync. It resolves with libsql's `Replicated` object (`frames_synced`,
 * `frame_no`). If the addon ever changes shape, `null` comes back and the
 * blocking `db.sync()` (same result object) is used instead.
 */
type NativeSync = (this: unknown) => Promise<{ frames_synced?: number } | undefined>;
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

/** True for the errors libsql raises when a push is refused because the cloud moved on. */
export function isSyncConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /InvalidPushFrameConflict|InvalidPushFrameNoHigh|returned a conflict|higher frame_no/i.test(message);
}

export function openLibsql(filePath: string, options: LibsqlOpenOptions = {}): LibsqlConnection {
  let db: Database.Database | null = null;
  const replica = !!options.sync;
  const offline = !!options.sync?.offline;
  const readOnly = !!options.readOnly;

  const ensure = (): Database.Database => {
    if (!db) {
      // `authToken` / `offline` are read by libsql's constructor (index.js)
      // though the bundled better-sqlite3-style typings only list `syncUrl`.
      const next = options.sync
        ? new Database(filePath, {
            syncUrl: options.sync.syncUrl,
            authToken: options.sync.authToken,
            offline,
          } as any)
        : new Database(filePath);
      try {
        next.exec("PRAGMA foreign_keys = ON");
        // A remote-replica connection accepts only the PRAGMAs libsql knows
        // how to classify: foreign_keys yes, busy_timeout no
        // (Sqlite3UnsupportedStatement). A synced database is a plain local
        // connection and takes it (verified Oct 29 2026).
        if (!replica || offline) next.exec("PRAGMA busy_timeout = 5000");
        // query_only makes SQLite itself reject INSERT/UPDATE/DELETE/DDL on this
        // connection — the read-only fallback for a database that must not
        // diverge (also unsupported on a remote replica).
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
    offline,
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
    async sync(syncOptions: SyncOptions = {}): Promise<SyncResult> {
      if (!replica) throw new Error(`${filePath} is not synced with a remote; nothing to sync`);
      const handle = ensure();
      const asyncSync = loadNativeAsyncSync();
      // The native handle lives in `db.db` on the JS wrapper (libsql/index.js).
      const nativeHandle = (handle as unknown as { db: unknown }).db;
      const run = async (): Promise<SyncResult> => {
        const result = asyncSync && nativeHandle ? await asyncSync.call(nativeHandle) : (handle.sync() as any);
        return { framesSynced: Number(result?.frames_synced ?? 0) };
      };
      if (!syncOptions.timeoutMs) return run();
      // A host that accepts the connection and never answers would hold the
      // caller (and the store's lock) forever; libsql has no timeout of its
      // own. The native call keeps running after the rejection and settles
      // on its own later — harmless, nothing waits for it any more.
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          run(),
          new Promise<SyncResult>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Sync timed out after ${syncOptions.timeoutMs} ms`)), syncOptions.timeoutMs);
            timer.unref?.();
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
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
      // for a synced database its sync context, which holds the file too —
      // lives until the JS wrapper is collected. One more GC + tick with the
      // reference gone releases the file at once (measured Oct 2026).
      collectGarbage();
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
}
