/**
 * store.ts — the shared data layer: every read and write the app makes, over
 * nothing but `exec(sql, params)` (sql.ts).
 *
 * It reproduces what the Express routes + Prisma client did before Oct 2026,
 * so the route tests (main/api-server.routes.test.ts) stay the behavioural
 * contract:
 *   - list():   `?field=value` equality filters, `?field_like=` contains,
 *               `_sort` / `_order` ordering, total count (x-total-count);
 *               `_start` / `_end` / `q` are accepted and ignored
 *   - create(): client ids are ignored (cuid generated), `now()` timestamps
 *               filled, literal defaults left to the DDL, strict value checks
 *   - update(): the URL id wins over a body id; a missing row is an error
 *   - remove(): a missing row is an error; FK cascades/SET NULL are SQLite's
 *   - rules:    Income single-primary (create/update demote the others),
 *               AppSettings/global upsert on first save, the
 *               BudgetCategoryItem delete name snapshot
 *
 * Concurrency: a backend is one connection, and the Express routes run
 * interleaved, so every public method takes the store's lock. Transactions
 * (BEGIN … COMMIT) hold it for their whole span; a failure rolls back.
 */
import { cuid } from "./cuid";
import { fromStorage, toStorage, transformBody } from "./coerce";
import { DataError } from "./errors";
import { SCHEMA_SQL } from "./schema-sql";
import { MODELS, SCHEMA_VERSION, resolveModel, type Column, type Model } from "./schema";
import {
  quoteIdent,
  splitStatements,
  type Row,
  type SqlConnection,
  type SqlExecutor,
  type SqlValue,
  type SyncOptions,
  type SyncResult,
} from "./sql";

/** `exec` as a bare function — what the store's internals pass around. */
type Exec = (sql: string, params?: SqlValue[]) => Promise<Row[]>;

/** A record as the app sees it: Dates, booleans, numbers, strings, nulls. */
export type Record_ = { [column: string]: unknown };

/**
 * The REST query of a list call, exactly as @refinedev/simple-rest sends it
 * (`{ accountId: "…", name_like: "Alp", _sort: "date", _order: "desc" }`).
 * The phone's data provider builds the same object without HTTP.
 */
export type ListQuery = { [key: string]: unknown };

export interface ListResult {
  items: Record_[];
  total: number;
}

/** One write inside `DataStore.batch()` — the same inputs as the matching single call. */
export type BatchOperation =
  | { op: "create"; model: Model; values: Record_ }
  | { op: "update"; model: Model; id: string; values: Record_ }
  | { op: "delete"; model: Model; id: string };

/** The stored row for a create / update, `{ success: true }` for a delete. */
export type BatchResult = Record_ | { success: true };

/** Body keys the routes always dropped (relation names + the id). */
const CREATE_STRIP = ["id", "client", "contracts"];
const UPDATE_STRIP = ["id", "client", "contracts", "entries"];
const LIST_CONTROL_KEYS = ["_sort", "_order", "_start", "_end", "q"];

// ── Schema management ───────────────────────────────────────────────────────

/** Apply schema.sql to an EMPTY database: all tables + the version stamp. */
export async function createDatabase(db: SqlExecutor): Promise<void> {
  for (const statement of splitStatements(SCHEMA_SQL)) await db.exec(statement);
}

/** Highest applied version, 0 when the table does not exist yet. */
export async function getSchemaVersion(db: SqlExecutor): Promise<number> {
  const tables = await db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'SchemaVersion'",
  );
  if (tables.length === 0) return 0;
  const rows = await db.exec('SELECT max("version") AS v FROM "SchemaVersion"');
  return Number(rows[0]?.v ?? 0);
}

/**
 * Bring a database that predates the data layer (a dev.db / PROD file that
 * Prisma created) up to the current bookkeeping: the SchemaVersion table and
 * its stamp. Idempotent. Future schema versions add their migration here.
 */
export async function ensureSchemaVersion(db: SqlExecutor): Promise<number> {
  const current = await getSchemaVersion(db);
  if (current >= SCHEMA_VERSION) return current;
  if (current === 0) {
    const create = splitStatements(SCHEMA_SQL).find((s) => s.includes('CREATE TABLE "SchemaVersion"'));
    if (!create) throw new Error("schema.sql has no SchemaVersion table");
    await db.exec(create.replace('CREATE TABLE "SchemaVersion"', 'CREATE TABLE IF NOT EXISTS "SchemaVersion"'));
  }
  // Versions > 1 will run their migration steps here before stamping.
  await db.exec('INSERT INTO "SchemaVersion" ("version", "appliedAt") VALUES (?, ?)', [
    SCHEMA_VERSION,
    Date.now(),
  ]);
  return SCHEMA_VERSION;
}

/**
 * First-use hook for any connection: a file with no tables at all gets the
 * full schema (a brand-new install or phone), anything else gets the version
 * bookkeeping. Nothing about existing rows is touched.
 */
export async function prepareDatabase(db: SqlExecutor): Promise<void> {
  const tables = await db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  if (tables.length === 0) await createDatabase(db);
  else await ensureSchemaVersion(db);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function columnOf(model: Model, name: string): Column {
  const col = model.columns.find((c) => c.name === name);
  if (!col) {
    throw new DataError("VALIDATION", `Unknown argument \`${name}\` for ${model.name}.`);
  }
  return col;
}

function selectList(model: Model): string {
  return model.columns.map((c) => quoteIdent(c.name)).join(", ");
}

function toRecord(model: Model, row: Row): Record_ {
  const out: Record_ = {};
  for (const col of model.columns) out[col.name] = fromStorage(col.type, row[col.name]);
  return out;
}

/** Prisma's `contains`: LIKE with the user's `%` / `_` escaped. */
function likePattern(value: string): string {
  return "%" + value.replace(/[\\%_]/g, (ch) => `\\${ch}`) + "%";
}

/** Simple promise-chain mutex. */
class Lock {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

// ── The store ───────────────────────────────────────────────────────────────

export class DataStore {
  private readonly lock = new Lock();
  private prepared: Promise<void> | null = null;

  constructor(private readonly connection: SqlConnection) {}

  private readonly exec: Exec = (sql, params) => this.connection.exec(sql, params);

  /** Serialised access + one-time schema bookkeeping on first use. */
  private locked<T>(fn: (exec: Exec) => Promise<T>): Promise<T> {
    return this.lock.run(async () => {
      if (!this.prepared) this.prepared = prepareDatabase(this.connection);
      try {
        await this.prepared;
      } catch (e) {
        this.prepared = null; // try again on the next call
        throw e;
      }
      return fn(this.exec);
    });
  }

  /** BEGIN … COMMIT around `fn`, ROLLBACK on any failure. */
  private transaction<T>(fn: (exec: Exec) => Promise<T>): Promise<T> {
    return this.locked(async (exec) => {
      await exec("BEGIN");
      try {
        const result = await fn(exec);
        await exec("COMMIT");
        return result;
      } catch (e) {
        try {
          await exec("ROLLBACK");
        } catch {
          /* the original error matters more */
        }
        throw e;
      }
    });
  }

  /** Model for a REST resource name, `undefined` for an unknown one. */
  resolveResource(resource: string): Model | undefined {
    return resolveModel(resource);
  }

  /** Raw statement, outside any transaction (VACUUM INTO, test table wipes). */
  raw(sql: string, params: SqlValue[] = []): Promise<Row[]> {
    return this.locked((exec) => exec(sql, params));
  }

  /** Release the file. The next call reopens lazily. */
  close(): Promise<void> {
    return this.lock.run(async () => {
      this.prepared = null;
      await this.connection.close();
    });
  }

  async schemaVersion(): Promise<number> {
    return this.locked(() => getSchemaVersion(this.connection));
  }

  /**
   * Push this file's writes to the remote and pull the others' (a synced
   * database, backends/libsql.ts). Takes the lock like every other call so
   * no statement runs while frames are being applied — a statement that
   * arrives meanwhile waits for the sync, which is why callers bound it
   * with `timeoutMs`. Rejects when the connection has nothing to sync with.
   */
  sync(options?: SyncOptions): Promise<SyncResult> {
    return this.lock.run(async () => {
      if (!this.connection.sync) throw new Error("This database is not synced with a remote.");
      return this.connection.sync(options);
    });
  }

  // ── Reads ──

  list(model: Model, query: ListQuery = {}): Promise<ListResult> {
    return this.locked(async (exec) => {
      const where: string[] = [];
      const params: SqlValue[] = [];
      for (const key of Object.keys(query)) {
        if (LIST_CONTROL_KEYS.includes(key)) continue;
        const value = query[key];
        if (key.endsWith("_like")) {
          const col = columnOf(model, key.slice(0, -5));
          if (col.type !== "String" || typeof value !== "string") {
            throw new DataError("VALIDATION", `Argument \`${col.name}\`: \`contains\` needs a string on a String field.`);
          }
          where.push(`${quoteIdent(col.name)} LIKE ? ESCAPE '\\'`);
          params.push(likePattern(value));
        } else {
          const col = columnOf(model, key);
          if (typeof value !== "string") {
            throw new DataError("VALIDATION", `Argument \`${col.name}\`: Invalid filter value.`);
          }
          // Query-string values are strings; only String (and DateTime, which
          // Prisma parsed) columns accept them. Filtering an Int/Boolean by
          // a string was a validation error before and stays one.
          where.push(`${quoteIdent(col.name)} = ?`);
          params.push(toStorage(col, value));
        }
      }

      let orderBy = "";
      if (query._sort !== undefined && query._sort !== null && query._sort !== "") {
        const order = String(query._order ?? "asc").toLowerCase();
        if (order !== "asc" && order !== "desc") {
          throw new DataError("VALIDATION", `Invalid sort order \`${order}\` (expected asc or desc).`);
        }
        const fields = String(query._sort)
          .split(",")
          .map((f) => columnOf(model, f.trim()).name);
        orderBy = " ORDER BY " + fields.map((f) => `${quoteIdent(f)} ${order.toUpperCase()}`).join(", ");
      }

      const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
      const table = quoteIdent(model.name);
      const rows = await exec(`SELECT ${selectList(model)} FROM ${table}${whereSql}${orderBy}`, params);
      const countRows = await exec(`SELECT count(*) AS c FROM ${table}${whereSql}`, params);
      return { items: rows.map((r) => toRecord(model, r)), total: Number(countRows[0]?.c ?? 0) };
    });
  }

  getOne(model: Model, id: string): Promise<Record_ | null> {
    return this.locked((exec) => this.findById(exec, model, id));
  }

  count(model: Model): Promise<number> {
    return this.locked(async (exec) => {
      const rows = await exec(`SELECT count(*) AS c FROM ${quoteIdent(model.name)}`);
      return Number(rows[0]?.c ?? 0);
    });
  }

  private async findById(exec: Exec, model: Model, id: string): Promise<Record_ | null> {
    const rows = await exec(
      `SELECT ${selectList(model)} FROM ${quoteIdent(model.name)} WHERE ${quoteIdent(model.idColumn)} = ?`,
      [id],
    );
    return rows.length ? toRecord(model, rows[0]) : null;
  }

  // ── Writes ──
  // The single calls and `batch()` share the same rules (applyCreate /
  // applyUpdate / applyRemove below), so a row written inside a batch is
  // exactly the row the matching single call would have written.

  /**
   * Insert one row from a request body. `id` and the legacy relation keys are
   * dropped, the body is normalised (transformBody), defaults are generated,
   * and the stored row is returned.
   */
  create(model: Model, body: Record_): Promise<Record_> {
    const run = (exec: Exec) => this.applyCreate(exec, model, body);
    // Income is two statements (demote the others, insert), hence the
    // transaction; every other create is one autocommitted INSERT.
    return model.name === "Income" ? this.transaction(run) : this.locked(run);
  }

  /**
   * Patch one row. The id comes from the caller, never the body. A missing
   * row is a NOT_FOUND error — except `AppSettings/global`, which is created
   * on its first save so a brand-new database can store its settings.
   */
  update(model: Model, id: string, body: Record_): Promise<Record_> {
    const run = (exec: Exec) => this.applyUpdate(exec, model, id, body);
    const multiStatement = model.name === "Income" || (model.name === "AppSettings" && id === "global");
    return multiStatement ? this.transaction(run) : this.locked(run);
  }

  /**
   * Delete one row. Deleting a BudgetCategoryItem first copies its name onto
   * every transaction that used it (`categoryName`), so the history keeps its
   * label after `categoryItemId` is set to NULL by the foreign key.
   */
  remove(model: Model, id: string): Promise<void> {
    return this.transaction((exec) => this.applyRemove(exec, model, id));
  }

  /**
   * Many writes as ONE transaction: one BEGIN … COMMIT, so the file is
   * written once (a single WAL commit — a handful of frames instead of a few
   * per row) and a failure anywhere rolls every operation back. Operations
   * run in the order given; each result is the stored row (create / update)
   * or `{ success: true }` (delete), one per operation.
   *
   * Added Nov 6 2026 for Overview's Optimize, which rewrites up to ~2000
   * BillSplit rows at once. As one request per row, each its own commit, the
   * run took long enough for the background sync to start in the middle of
   * it — and a sync holds this lock for its whole round trip to the cloud,
   * so every write and every read of the UI queued behind it (the app
   * froze), while the thousands of WAL frames those commits left took many
   * pushes to send (the run ended in a sync conflict). Anything that writes
   * many rows should come through here.
   */
  batch(operations: readonly BatchOperation[]): Promise<BatchResult[]> {
    return this.transaction(async (exec) => {
      const results: BatchResult[] = [];
      for (const op of operations) {
        switch (op.op) {
          case "create":
            results.push(await this.applyCreate(exec, op.model, op.values));
            break;
          case "update":
            results.push(await this.applyUpdate(exec, op.model, op.id, op.values));
            break;
          case "delete":
            await this.applyRemove(exec, op.model, op.id);
            results.push({ success: true });
            break;
          default:
            throw new DataError("VALIDATION", `Unknown batch operation "${String((op as { op: unknown }).op)}".`);
        }
      }
      return results;
    });
  }

  // ── The write rules, on an executor the caller already holds ──
  // (the store's lock, inside a transaction where more than one statement
  // runs). Shared by create / update / remove and batch.

  private primaryFlag(body: Record_): boolean {
    return body.isPrimary === true || body.isPrimary === "true";
  }

  /** create(): plus the Income single-primary rule (a new primary demotes the others). */
  private async applyCreate(exec: Exec, model: Model, body: Record_): Promise<Record_> {
    const data = this.prepareCreate(body);
    if (model.name === "Income") {
      const isPrimary = this.primaryFlag(data);
      if (isPrimary) await exec('UPDATE "Income" SET "isPrimary" = 0');
      return this.insert(exec, model, { ...data, isPrimary });
    }
    return this.insert(exec, model, data);
  }

  /**
   * update(): plus the Income single-primary rule (a patch WITHOUT isPrimary
   * clears it — historic quirk, kept) and the AppSettings/global upsert.
   */
  private async applyUpdate(exec: Exec, model: Model, id: string, body: Record_): Promise<Record_> {
    const data = this.prepareUpdate(body);
    if (model.name === "Income") {
      const isPrimary = this.primaryFlag(data);
      if (isPrimary) await exec('UPDATE "Income" SET "isPrimary" = 0 WHERE "id" != ?', [id]);
      return this.patch(exec, model, id, { ...data, isPrimary });
    }
    if (model.name === "AppSettings" && id === "global") {
      const existing = await this.findById(exec, model, id);
      if (existing) return this.patch(exec, model, id, data);
      return this.insert(exec, model, { ...data, id });
    }
    return this.patch(exec, model, id, data);
  }

  /** remove(): plus the BudgetCategoryItem name snapshot. */
  private async applyRemove(exec: Exec, model: Model, id: string): Promise<void> {
    if (model.name === "BudgetCategoryItem") {
      const item = await this.findById(exec, model, id);
      if (item) {
        await exec('UPDATE "AccountTransaction" SET "categoryName" = ? WHERE "categoryItemId" = ?', [
          item.name as string,
          id,
        ]);
      }
    }
    const result = await exec(
      `DELETE FROM ${quoteIdent(model.name)} WHERE ${quoteIdent(model.idColumn)} = ? RETURNING ${quoteIdent(model.idColumn)}`,
      [id],
    );
    if (result.length === 0) {
      throw new DataError("NOT_FOUND", `Record to delete does not exist (${model.name} ${id}).`);
    }
  }

  // ── Row-level primitives ──

  private prepareCreate(body: Record_): Record_ {
    const data = transformBody(body ?? {});
    for (const key of CREATE_STRIP) delete data[key];
    return data;
  }

  private prepareUpdate(body: Record_): Record_ {
    const data = transformBody(body ?? {});
    for (const key of UPDATE_STRIP) delete data[key];
    return data;
  }

  private async insert(exec: Exec, model: Model, data: Record_): Promise<Record_> {
    const names: string[] = [];
    const values: SqlValue[] = [];
    const given = new Set<string>();
    for (const key of Object.keys(data)) {
      const value = data[key];
      if (value === undefined) continue;
      const col = columnOf(model, key);
      names.push(col.name);
      values.push(toStorage(col, value));
      given.add(col.name);
    }
    for (const col of model.columns) {
      if (given.has(col.name) || !col.generated) continue;
      names.push(col.name);
      values.push(col.generated === "cuid" ? cuid() : Date.now());
    }
    const table = quoteIdent(model.name);
    const columns = names.map(quoteIdent).join(", ");
    const placeholders = names.map(() => "?").join(", ");
    const rows = await exec(
      names.length
        ? `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING ${selectList(model)}`
        : `INSERT INTO ${table} DEFAULT VALUES RETURNING ${selectList(model)}`,
      values,
    );
    return toRecord(model, rows[0]);
  }

  private async patch(exec: Exec, model: Model, id: string, data: Record_): Promise<Record_> {
    const sets: string[] = [];
    const values: SqlValue[] = [];
    for (const key of Object.keys(data)) {
      const value = data[key];
      if (value === undefined) continue;
      const col = columnOf(model, key);
      sets.push(`${quoteIdent(col.name)} = ?`);
      values.push(toStorage(col, value));
    }
    const table = quoteIdent(model.name);
    const idCol = quoteIdent(model.idColumn);
    const rows = sets.length
      ? await exec(`UPDATE ${table} SET ${sets.join(", ")} WHERE ${idCol} = ? RETURNING ${selectList(model)}`, [
          ...values,
          id,
        ])
      : await exec(`SELECT ${selectList(model)} FROM ${table} WHERE ${idCol} = ?`, [id]);
    if (rows.length === 0) {
      throw new DataError("NOT_FOUND", `Record to update not found (${model.name} ${id}).`);
    }
    return toRecord(model, rows[0]);
  }
}

/** Models the generic REST routes serve (everything that isn't internal). */
export const RESOURCE_MODELS: readonly Model[] = MODELS.filter((m) => !m.internal);
