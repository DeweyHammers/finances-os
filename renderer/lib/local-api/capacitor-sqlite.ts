/**
 * capacitor-sqlite.ts — the phone backend of the shared data layer: a
 * `SqlConnection` (shared/data/sql.ts) over @capacitor-community/sqlite, so
 * `DataStore` runs on Android against the phone's own SQLite file exactly as
 * it runs on the desktop over libsql.
 *
 * Why this plugin (Phase C decision, Oct 2026): it is the one maintained
 * Capacitor SQLite plugin — 8.x tracks Capacitor 8, Android half bundled
 * (no native build of our own, no paid component), and the SAME JS API
 * runs in a desktop browser through jeep-sqlite + sql.js, so the phone data
 * path can be exercised on a PC with no Android toolchain. Weighed and
 * rejected: Ionic's `@ionic-enterprise/secure-storage` (paid), Cordova's
 * `cordova-sqlite-storage` (unmaintained, no RETURNING, Cordova shim), and
 * sql.js alone in the WebView (the whole database in memory, persisted as
 * one blob — a killed app loses the last writes).
 *
 * What the wrapper does besides forwarding statements:
 *   - Transactions: the store sends plain BEGIN / COMMIT / ROLLBACK; the
 *     plugin only accepts those through its own methods (its `run` with
 *     `transaction: true` would open a second, nested one), so they are
 *     mapped, and every statement runs with `transaction: false`.
 *   - RETURNING: the plugin's Android half rewrites RETURNING itself — it
 *     strips the clause, executes, then re-selects by a rowid range (INSERT)
 *     or by re-parsing the WHERE clause WITHOUT the bound parameters
 *     (UPDATE / DELETE). That is wrong for the store's parameterised
 *     `UPDATE … WHERE "id" = ? RETURNING …` and fragile for INSERT (the
 *     rowid range comes from last_insert_rowid() across ALL tables). So the
 *     clause is stripped HERE and the rows read back with a SELECT that
 *     carries the right parameters: INSERT → by the key the store itself
 *     supplied (the first RETURNING column's value among the parameters;
 *     `rowid = last_insert_rowid()` only as the fallback, see insertedKey),
 *     UPDATE → the statement's own WHERE after the write, DELETE → the same
 *     SELECT before the delete. The store emits exactly those three shapes
 *     (store.ts → insert / patch / remove).
 *   - Routing: DDL and PRAGMA assignments through `execute`, reads through
 *     `query`, writes through `run`. `PRAGMA foreign_keys = ON` is set on
 *     open: the plugin leaves it off, and the schema's ON DELETE CASCADE /
 *     SET NULL depend on it (as they did under Prisma and do under libsql).
 *   - Web: jeep-sqlite keeps the database in memory and persists it to
 *     IndexedDB only on `saveToStore`, so that is called after every write
 *     that lands outside a transaction and after every COMMIT.
 *
 * The plugin's own modules are loaded lazily (openPhoneDatabase) so the
 * desktop bundle never pulls them in.
 */
import type { Row, SqlConnection, SqlValue } from "../../../shared/data/sql";

/** Name of the phone's database; the plugin stores it as `<name>SQLite.db`. */
export const PHONE_DATABASE = "finances-os";

/** The slice of the plugin's `SQLiteDBConnection` this file uses (tests hand in a fake). */
export interface PluginConnection {
  query(statement: string, values?: unknown[]): Promise<{ values?: unknown[] }>;
  run(
    statement: string,
    values?: unknown[],
    transaction?: boolean,
    returnMode?: string,
  ): Promise<{ changes?: { changes?: number; lastId?: number; values?: unknown[] } }>;
  execute(statements: string, transaction?: boolean): Promise<unknown>;
  beginTransaction(): Promise<unknown>;
  commitTransaction(): Promise<unknown>;
  rollbackTransaction(): Promise<unknown>;
  close(): Promise<void>;
}

export interface WrapOptions {
  /** Runs after a write that landed (outside a transaction, or at COMMIT): web persistence. */
  persist?: () => Promise<void>;
  /** Releases the plugin connection instead of `db.close()`. */
  release?: () => Promise<void>;
}

const READS = /^(SELECT|WITH|EXPLAIN)\b/i;
const DDL = /^(CREATE|DROP|ALTER)\b/i;
const RETURNING = /\sRETURNING\s+([^;]+?)\s*;?\s*$/i;

export interface ReturningSplit {
  /** The statement without its RETURNING clause. */
  body: string;
  /** The clause's column list, verbatim. */
  columns: string;
}

/** `INSERT … RETURNING a, b` → the write and the column list; null without a clause. */
export function splitReturning(sql: string): ReturningSplit | null {
  const m = RETURNING.exec(sql);
  if (!m) return null;
  return { body: sql.slice(0, m.index).trim(), columns: m[1].trim() };
}

export interface WriteShape {
  kind: "INSERT" | "UPDATE" | "DELETE";
  /** Table name as written (quoted or not). */
  table: string;
  /** The WHERE clause's text (after the keyword), null when there is none. */
  where: string | null;
}

/** The parts of a write the RETURNING emulation needs. Throws on anything else. */
export function parseWrite(body: string): WriteShape {
  const ident = '("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)';
  let m = new RegExp(`^INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${ident}`, "i").exec(body);
  if (m) return { kind: "INSERT", table: m[1], where: null };
  m = new RegExp(`^UPDATE\\s+${ident}\\s+SET\\s+[\\s\\S]*?(?:\\s+WHERE\\s+([\\s\\S]+))?$`, "i").exec(body);
  if (m) return { kind: "UPDATE", table: m[1], where: m[2]?.trim() ?? null };
  m = new RegExp(`^DELETE\\s+FROM\\s+${ident}(?:\\s+WHERE\\s+([\\s\\S]+))?$`, "i").exec(body);
  if (m) return { kind: "DELETE", table: m[1], where: m[2]?.trim() ?? null };
  throw new Error(`RETURNING is only emulated for INSERT / UPDATE / DELETE, got: ${body.slice(0, 40)}…`);
}

/** How many `?` placeholders a clause binds (the store never puts `?` in a literal). */
export function countPlaceholders(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

export interface InsertedKey {
  /** The key column, as written in the statement. */
  column: string;
  /** Position of its value in the statement's parameters. */
  index: number;
}

/**
 * Which parameter of `INSERT INTO t (cols) VALUES (?, …)` holds the row's
 * key, taking the FIRST column of the RETURNING list as the key (the store
 * always lists the id column first and always supplies its value — a cuid,
 * or "global" for AppSettings). Null when the statement isn't that shape,
 * in which case the caller falls back to `rowid = last_insert_rowid()` —
 * which is NOT reliable on every engine: jeep-sqlite's autosave exports the
 * sql.js database after a statement, and the export reopens the connection
 * and resets last_insert_rowid() (found Oct 2026: the row was inserted, the
 * read-back came back empty, and the store crashed on `rows[0].id`).
 */
export function insertedKey(body: string, returning: string): InsertedKey | null {
  const m = /^INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(?:"[^"]+"|\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)\s*$/i.exec(body);
  if (!m) return null;
  const columns = m[1].split(",").map((c) => c.trim());
  const values = m[2].split(",").map((v) => v.trim());
  // Only an all-placeholder VALUES list maps positions onto parameters.
  if (values.length !== columns.length || values.some((v) => v !== "?")) return null;
  const column = returning.split(",")[0]?.trim() ?? "";
  const index = columns.indexOf(column);
  return index >= 0 ? { column, index } : null;
}

/** Bind values the plugin's bridge can carry: bigint → number, the rest as is. */
function bindable(params: SqlValue[]): unknown[] {
  return params.map((v) => (typeof v === "bigint" ? Number(v) : v));
}

/**
 * Turn a plugin connection into the data layer's `SqlConnection`. Exported
 * on its own so the statement routing and the RETURNING emulation can be
 * tested with a fake connection (capacitor-sqlite.test.ts); the app uses it
 * through openPhoneDatabase.
 */
export function wrapPluginConnection(db: PluginConnection, options: WrapOptions = {}): SqlConnection {
  let inTransaction = false;

  const rowsOf = (result: { values?: unknown[] }): Row[] => (result.values ?? []) as Row[];
  const persist = async (): Promise<void> => {
    if (!inTransaction && options.persist) await options.persist();
  };
  const write = async (sql: string, params: SqlValue[]): Promise<void> => {
    // `returnMode: "no"` — the plugin must not try its own RETURNING handling.
    await db.run(sql, bindable(params), false, "no");
  };

  return {
    async exec(sql: string, params: SqlValue[] = []): Promise<Row[]> {
      const statement = sql.trim();
      const word = statement.split(/\s+/)[0]?.toUpperCase() ?? "";

      if (word === "BEGIN") {
        await db.beginTransaction();
        inTransaction = true;
        return [];
      }
      if (word === "COMMIT") {
        await db.commitTransaction();
        inTransaction = false;
        await persist();
        return [];
      }
      if (word === "ROLLBACK") {
        await db.rollbackTransaction();
        inTransaction = false;
        return [];
      }
      if (word === "PRAGMA") {
        // `PRAGMA x = y` is a setting (no rows), `PRAGMA x` a question.
        if (statement.includes("=")) {
          await db.execute(statement.endsWith(";") ? statement : `${statement};`, false);
          return [];
        }
        return rowsOf(await db.query(statement, bindable(params)));
      }
      if (READS.test(statement)) return rowsOf(await db.query(statement, bindable(params)));
      if (DDL.test(statement)) {
        await db.execute(statement.endsWith(";") ? statement : `${statement};`, false);
        await persist();
        return [];
      }

      const split = splitReturning(statement);
      if (!split) {
        await write(statement, params);
        await persist();
        return [];
      }

      // RETURNING emulation — see the file comment.
      const shape = parseWrite(split.body);
      let rows: Row[];
      if (shape.kind === "INSERT") {
        await write(split.body, params);
        const key = insertedKey(split.body, split.columns);
        rows = key
          ? rowsOf(await db.query(`SELECT ${split.columns} FROM ${shape.table} WHERE ${key.column} = ?`, [bindable(params)[key.index]]))
          : rowsOf(await db.query(`SELECT ${split.columns} FROM ${shape.table} WHERE rowid = last_insert_rowid()`));
      } else {
        const whereParams = shape.where ? bindable(params).slice(params.length - countPlaceholders(shape.where)) : [];
        const select = `SELECT ${split.columns} FROM ${shape.table}${shape.where ? ` WHERE ${shape.where}` : ""}`;
        if (shape.kind === "DELETE") {
          rows = rowsOf(await db.query(select, whereParams));
          await write(split.body, params);
        } else {
          await write(split.body, params);
          rows = rowsOf(await db.query(select, whereParams));
        }
      }
      await persist();
      return rows;
    },

    async close(): Promise<void> {
      if (options.release) await options.release();
      else await db.close();
    },
  };
}

/**
 * On a web platform the plugin runs on jeep-sqlite (a web component wrapping
 * sql.js) which must be in the DOM before `initWebStore`. The wasm is read
 * from `/assets/sql-wasm.wasm` (scripts/android/copy-sql-wasm.mjs puts it
 * in renderer/public for the browser check).
 */
async function startWebEngine(CapacitorSQLite: { initWebStore(): Promise<void> }): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("The web SQLite engine needs a browser window.");
  }
  const { defineCustomElements } = await import("jeep-sqlite/loader");
  defineCustomElements(window);
  if (!document.querySelector("jeep-sqlite")) {
    const el = document.createElement("jeep-sqlite") as HTMLElement & { autoSave?: boolean; wasmPath?: string };
    // No autoSave: it exports the sql.js database after every statement
    // (slow, and the export reopens the connection — see insertedKey). The
    // wrapper's `persist` saves once per write / COMMIT instead.
    el.autoSave = false;
    el.wasmPath = "/assets";
    document.body.appendChild(el);
  }
  await customElements.whenDefined("jeep-sqlite");
  await CapacitorSQLite.initWebStore();
}

/**
 * Open (creating on first use) the phone's database and return the data
 * layer's connection to it. The schema itself is applied by the store's
 * prepareDatabase on the first statement, like on the desktop.
 */
export async function openPhoneDatabase(name = PHONE_DATABASE): Promise<SqlConnection> {
  const { Capacitor } = await import("@capacitor/core");
  const { CapacitorSQLite, SQLiteConnection } = await import("@capacitor-community/sqlite");
  const web = Capacitor.getPlatform() === "web";
  if (web) await startWebEngine(CapacitorSQLite);

  const sqlite = new SQLiteConnection(CapacitorSQLite);
  try {
    // Drops connections the native side still holds from a previous WebView
    // (a reload); harmless when there are none.
    await sqlite.checkConnectionsConsistency();
  } catch {
    /* nothing open yet */
  }
  const existing = (await sqlite.isConnection(name, false)).result === true;
  const db = existing
    ? await sqlite.retrieveConnection(name, false)
    : await sqlite.createConnection(name, false, "no-encryption", 1, false);
  await db.open();

  const connection = wrapPluginConnection(db, {
    persist: web ? () => sqlite.saveToStore(name) : undefined,
    release: () => sqlite.closeConnection(name, false),
  });
  await connection.exec("PRAGMA foreign_keys = ON");
  const check = await connection.exec("PRAGMA foreign_keys");
  if (Number(check[0]?.foreign_keys) !== 1) {
    // Deletes would then leave child rows behind. Say so loudly; the app
    // still works for everything else.
    console.warn("[finances-os] SQLite foreign keys could not be enabled on this device", check);
  }
  return connection;
}
