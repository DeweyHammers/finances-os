/**
 * migrations.ts — how a database made by an OLDER build is brought up to this
 * build's SCHEMA_VERSION.
 *
 * Until Nov 2026 there were no migrations: PROD got a new column by copying
 * dev.db over it (`npm run db:push`). That stopped being possible when the
 * installed app became a synced copy of the user's cloud database (local-first
 * sync, Oct 29 2026): the file the app reads is `replica.db`, and the cloud
 * has no file to overwrite at all. So schema changes now travel as ordinary
 * SQL, run by the app itself:
 *
 *   - LOCAL (a plain file, or the synced copy): `ensureSchemaVersion` in
 *     store.ts runs these statements on a store's first use, inside one
 *     transaction with the version stamp. On a synced copy they are normal
 *     local writes, so the next sync pushes them to the cloud like any save.
 *   - CLOUD, when the app is about to load a whole dump into it (Sandbox Keep,
 *     Import, "keep this PC's changes", the first upload onto an old cloud
 *     database): `main/sync.ts → replaceRemote` runs the same statements over
 *     Hrana first, because the dump's INSERTs name this build's columns.
 *
 * RULES for adding a version:
 *   1. The SQL here is FROZEN text, never derived from the current schema.sql:
 *      step N must keep producing the version-N shape after version N+1
 *      changes the same table. Copy the DDL `prisma migrate diff` printed.
 *   2. New columns go LAST in their Prisma model (ALTER TABLE appends), so a
 *      migrated file and a fresh one list the same columns in the same order.
 *   3. Every step is idempotent — it looks at `sqlite_master` and only emits
 *      what is missing. dev.db may already have the shape (`prisma db push`),
 *      and a database whose SchemaVersion table was lost re-runs every step.
 *   4. Only `sqlite_master` is read (no PRAGMA): it is the one catalogue query
 *      the cloud side is known to answer (main/sync.ts → probe uses it too).
 *   5. migrations.test.ts builds a version-1 database from its frozen
 *      schema, migrates it and compares it column by column with a fresh one.
 *      Keep that passing; add the previous version's schema.sql as a fixture.
 *
 * An OLDER app meeting a NEWER database is the other direction and is not
 * handled here: the schema gate (transfer.ts → schemaVersionGate, main/sync.ts)
 * makes it refuse to write and ask for an update.
 */
import type { SqlExecutor } from "./sql";

/** `name → CREATE statement` for every table and index in the database. */
async function readCatalogue(db: SqlExecutor): Promise<Map<string, string>> {
  const rows = await db.exec("SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index')");
  return new Map(rows.map((r) => [String(r.name), String(r.sql ?? "")]));
}

// ── Version 2 (Nov 2026): per-week income ───────────────────────────────────
// Income.baseHours / baseTaxes / baseFlatDeductions (the hours behind the
// regular amount and what comes out of it — they turn "32 hours this week"
// into an estimated paycheck) and IncomeOverride (one paycheck that differs
// from the regular one). See CLAUDE.md → "Per-week income overrides".

/** Income's new columns, in the order they are appended (= schema.prisma order). */
const V2_INCOME_COLUMNS = ["baseHours", "baseTaxes", "baseFlatDeductions"];

const V2_CREATE_INCOME_OVERRIDE = `CREATE TABLE "IncomeOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incomeId" TEXT NOT NULL,
    "payDate" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "hours" REAL,
    CONSTRAINT "IncomeOverride_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "Income" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`;

const V2_INDEX_NAME = "IncomeOverride_incomeId_payDate_key";
const V2_CREATE_INCOME_OVERRIDE_INDEX = `CREATE UNIQUE INDEX "${V2_INDEX_NAME}" ON "IncomeOverride"("incomeId", "payDate")`;

function version2Statements(catalogue: Map<string, string>): string[] {
  const statements: string[] = [];
  const income = catalogue.get("Income");
  // ALTER TABLE rewrites the table's stored CREATE statement, so the column
  // name appearing there means it is already present.
  // Checked one by one, so a file that already has some of them gets the rest.
  if (income !== undefined) {
    for (const column of V2_INCOME_COLUMNS) {
      if (!income.includes(`"${column}"`)) statements.push(`ALTER TABLE "Income" ADD COLUMN "${column}" REAL`);
    }
  }
  if (!catalogue.has("IncomeOverride")) statements.push(V2_CREATE_INCOME_OVERRIDE);
  if (!catalogue.has(V2_INDEX_NAME)) statements.push(V2_CREATE_INCOME_OVERRIDE_INDEX);
  return statements;
}

/**
 * The DDL that takes `db` — a database that already HAS the app's tables, at
 * any older version — to this build's shape. Empty when nothing is missing.
 * The version stamp is not included: the caller writes it (a local file in
 * the same transaction; a cloud database receives it with the dump's rows).
 */
export async function migrationStatements(db: SqlExecutor): Promise<string[]> {
  const catalogue = await readCatalogue(db);
  // No app tables at all (a brand-new file or cloud database): nothing to
  // migrate — it gets the whole current schema from schema.sql instead.
  if (!catalogue.has("Income")) return [];
  return [...version2Statements(catalogue)];
}
