/**
 * backends/libsql.ts — the desktop backend: a local SQLite file through the
 * `libsql` package (better-sqlite3-compatible, synchronous, no query engine).
 *
 * The file is opened lazily on the first statement and released by `close()`;
 * Sandbox mode relies on that to copy / overwrite / delete database files
 * while nothing holds them (shared/db.ts → switchDatabase). Every connection
 * turns foreign keys on (the schema's ON DELETE CASCADE / SET NULL depend on
 * it, as they did under Prisma) and waits up to 5 s on a locked file instead
 * of failing when another process (Prisma Studio, a backup) has it open.
 *
 * Phase B of plans/phone-app-and-sync.md adds the embedded-replica options
 * (`syncUrl`, `authToken`) here; nothing above this file changes for that.
 */
import Database from "libsql";
import v8 from "v8";
import vm from "vm";
import type { Row, SqlConnection, SqlValue } from "../sql";

export interface LibsqlConnection extends SqlConnection {
  /** Filesystem path of the database file. */
  readonly path: string;
  /** True while the file is open. */
  isOpen(): boolean;
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

export function openLibsql(filePath: string): LibsqlConnection {
  let db: Database.Database | null = null;

  const ensure = (): Database.Database => {
    if (!db) {
      db = new Database(filePath);
      db.exec("PRAGMA foreign_keys = ON");
      db.exec("PRAGMA busy_timeout = 5000");
    }
    return db;
  };

  return {
    path: filePath,
    isOpen: () => db !== null,
    async exec(sql: string, params: SqlValue[] = []): Promise<Row[]> {
      // `.all()` steps every statement to completion (and resets it), even
      // for INSERT / UPDATE / BEGIN, which `.run()` does not — a half-stepped
      // statement is another way to keep the file handle alive.
      const rows = ensure().prepare(sql).all(...params) as Row[];
      return rows;
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
    },
  };
}
