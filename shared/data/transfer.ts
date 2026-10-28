/**
 * transfer.ts — move a whole database from one place to another through the
 * data layer: dump every table's rows out of one executor and load them into
 * another. Backend-agnostic on purpose (plans/phone-app-and-sync.md): the same
 * code copies a local file into the cloud database on the first sync, pushes
 * a kept sandbox, imports an exported file, and takes a backup of an embedded
 * replica — on the desktop today and on the phone later.
 *
 * Why not copy the file? An embedded replica keeps recent frames in its WAL
 * and libsql's own index files, so a plain file copy can miss data, and the
 * cloud side has no file at all. Rows are the one representation every
 * backend shares. Values are moved verbatim (the stored INTEGER ms, 0/1, …),
 * never through coerce.ts, so a load is byte-faithful to the dump.
 *
 * Foreign keys: tables are ordered parents-before-children (`tablesInFkOrder`,
 * derived from the REFERENCES clauses in schema.sql) so inserts never see a
 * missing parent and deletes (reverse order) never see a dangling child, even
 * when a load is split into several transactions.
 */
import { MODELS, SCHEMA_VERSION, type Model } from "./schema";
import { SCHEMA_SQL } from "./schema-sql";
import { quoteIdent, splitStatements, type Row, type SqlExecutor, type SqlValue } from "./sql";

/** One table's rows, column names in MODELS order. */
export interface TableDump {
  table: string;
  columns: string[];
  rows: SqlValue[][];
}

export interface DatabaseDump {
  /** Highest SchemaVersion stamp in the source (0 = none). */
  schemaVersion: number;
  tables: TableDump[];
}

/** A statement with positional parameters, the shape `@libsql/client` batches take. */
export interface Statement {
  sql: string;
  args: SqlValue[];
}

// ── Table order ─────────────────────────────────────────────────────────────

/** `child → [parents]` read from the generated DDL's REFERENCES clauses. */
function foreignKeyParents(): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  for (const statement of splitStatements(SCHEMA_SQL)) {
    const table = /^CREATE TABLE "([^"]+)"/.exec(statement)?.[1];
    if (!table) continue;
    const parents = new Set<string>();
    for (const m of Array.from(statement.matchAll(/REFERENCES "([^"]+)"/g))) {
      if (m[1] !== table) parents.add(m[1]);
    }
    deps.set(table, Array.from(parents));
  }
  return deps;
}

let fkOrderCache: Model[] | null = null;

/** Every model, parents before children (stable within a dependency level). */
export function tablesInFkOrder(): Model[] {
  if (fkOrderCache) return fkOrderCache;
  const parentsOf = foreignKeyParents();
  const placed = new Set<string>();
  const ordered: Model[] = [];
  let remaining = [...MODELS];
  while (remaining.length) {
    const ready = remaining.filter((m) => (parentsOf.get(m.name) ?? []).every((p) => placed.has(p)));
    if (ready.length === 0) throw new Error("transfer.ts: foreign-key cycle in schema.sql");
    for (const m of ready) {
      ordered.push(m);
      placed.add(m.name);
    }
    remaining = remaining.filter((m) => !placed.has(m.name));
  }
  fkOrderCache = ordered;
  return ordered;
}

// ── Dump ────────────────────────────────────────────────────────────────────

/** Read every table (including the SchemaVersion stamp) out of `db`. */
export async function dumpDatabase(db: SqlExecutor): Promise<DatabaseDump> {
  const existing = new Set(
    (await db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => String(r.name)),
  );
  const tables: TableDump[] = [];
  for (const model of tablesInFkOrder()) {
    const columns = model.columns.map((c) => c.name);
    if (!existing.has(model.name)) {
      tables.push({ table: model.name, columns, rows: [] });
      continue;
    }
    const rows = await db.exec(
      `SELECT ${columns.map(quoteIdent).join(", ")} FROM ${quoteIdent(model.name)} ORDER BY rowid`,
    );
    tables.push({ table: model.name, columns, rows: rows.map((r: Row) => columns.map((c) => r[c] ?? null)) });
  }
  const version = tables.find((t) => t.table === "SchemaVersion");
  const schemaVersion = version
    ? version.rows.reduce((max, row) => Math.max(max, Number(row[version.columns.indexOf("version")] ?? 0)), 0)
    : 0;
  return { schemaVersion, tables };
}

/** Rows of user data in a dump (the SchemaVersion bookkeeping doesn't count). */
export function countDataRows(dump: DatabaseDump): number {
  return dump.tables.filter((t) => t.table !== "SchemaVersion").reduce((n, t) => n + t.rows.length, 0);
}

// ── Load ────────────────────────────────────────────────────────────────────

/** Keep each multi-row INSERT well under SQLite's bound-parameter limit. */
const MAX_PARAMS_PER_INSERT = 900;

/**
 * schema.sql with every CREATE made idempotent (and its version stamp an
 * INSERT OR IGNORE), so it can run on any target: a brand-new cloud database
 * gets its tables, an existing one is left alone.
 */
export function schemaStatementsIfNotExists(): string[] {
  return splitStatements(SCHEMA_SQL).map((sql) =>
    sql
      .replace(/^CREATE (TABLE|UNIQUE INDEX|INDEX) "/, "CREATE $1 IF NOT EXISTS \"")
      .replace(/^INSERT INTO "SchemaVersion"/, 'INSERT OR IGNORE INTO "SchemaVersion"'),
  );
}

/**
 * The statements that make `target` hold exactly the dump's rows:
 *   1. the schema DDL (`IF NOT EXISTS`, so a brand-new cloud database gets
 *      its tables and an existing one is left alone),
 *   2. `DELETE FROM` every table, children first,
 *   3. multi-row `INSERT`s, parents first.
 * Run them in order inside one transaction (or several, in order — the FK
 * ordering keeps every prefix consistent).
 */
export function loadStatements(dump: DatabaseDump): Statement[] {
  const statements: Statement[] = [];
  for (const sql of schemaStatementsIfNotExists()) statements.push({ sql, args: [] });
  const byName = new Map(dump.tables.map((t) => [t.table, t]));
  // A dump from a Prisma-era file has no SchemaVersion rows: the DDL's own
  // stamp (this app's version) then stays, instead of being deleted.
  const keepStamp = (byName.get("SchemaVersion")?.rows.length ?? 0) === 0;
  const order = tablesInFkOrder()
    .map((m) => m.name)
    .filter((name) => !(keepStamp && name === "SchemaVersion"));
  for (const name of [...order].reverse()) {
    statements.push({ sql: `DELETE FROM ${quoteIdent(name)}`, args: [] });
  }
  for (const name of order) {
    const table = byName.get(name);
    if (!table || table.rows.length === 0) continue;
    const cols = table.columns.map(quoteIdent).join(", ");
    const rowsPerInsert = Math.max(1, Math.floor(MAX_PARAMS_PER_INSERT / table.columns.length));
    for (let i = 0; i < table.rows.length; i += rowsPerInsert) {
      const chunk = table.rows.slice(i, i + rowsPerInsert);
      const placeholders = chunk.map(() => `(${table.columns.map(() => "?").join(", ")})`).join(", ");
      statements.push({
        sql: `INSERT INTO ${quoteIdent(name)} (${cols}) VALUES ${placeholders}`,
        args: chunk.flat(),
      });
    }
  }
  return statements;
}

/** True when `db` has none of the app's tables (a brand-new file or cloud database). */
export async function hasNoTables(db: SqlExecutor): Promise<boolean> {
  const rows = await db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'libsql_%'",
  );
  return rows.length === 0;
}

/**
 * Make `target` hold exactly the dump's rows, in one transaction. Foreign
 * keys are deferred to the COMMIT so the order of deletes inside the
 * transaction can't trip a RESTRICT constraint.
 */
export async function loadDatabase(target: SqlExecutor, dump: DatabaseDump): Promise<void> {
  const statements = loadStatements(dump);
  await target.exec("BEGIN");
  try {
    await target.exec("PRAGMA defer_foreign_keys = ON");
    for (const s of statements) await target.exec(s.sql, s.args);
    await target.exec("COMMIT");
  } catch (e) {
    try {
      await target.exec("ROLLBACK");
    } catch {
      /* the original error matters more */
    }
    throw e;
  }
}

/** Copy every row from `from` into `to` (see loadDatabase). */
export async function copyDatabase(from: SqlExecutor, to: SqlExecutor): Promise<DatabaseDump> {
  const dump = await dumpDatabase(from);
  await loadDatabase(to, dump);
  return dump;
}

/**
 * The schema-version gate of plans/phone-app-and-sync.md: a database written
 * by a newer app must not be touched by this one. Returns the message to show,
 * or null when the version is fine.
 */
export function schemaVersionGate(databaseVersion: number): string | null {
  if (databaseVersion <= SCHEMA_VERSION) return null;
  return `This database was made by a newer version of Finances OS (schema ${databaseVersion}; this app knows ${SCHEMA_VERSION}). Update the app on this device.`;
}
