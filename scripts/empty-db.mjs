// empty-db.mjs — creates an EMPTY SQLite database with the current schema,
// without needing any existing database file or the Prisma CLI.
//
// Used by:
//   - scripts/build-template-db.mjs → prisma/template.db, the file the
//     installer ships (a fresh install copies it to %APPDATA%).
//   - main/api-server.routes.test.ts → a throwaway test database. It used to
//     copy prisma/dev.db for the schema, which doesn't exist on a clean
//     checkout (dev.db is gitignored), so the suite failed on GitHub Actions.
//   - scripts/demo/create-db.mjs → prisma/demo.db for the picture tour.
//
// How: shared/data/schema.sql is the CREATE TABLE script generated from
// prisma/schema.prisma (scripts/generate-schema-sql.ts) plus the schema-
// version stamp — the same statements the data layer's createDatabase() runs.
// node:sqlite executes them; the result is verified to have tables and zero
// data rows before it's handed back (the SchemaVersion stamp is bookkeeping,
// not data).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_SQL_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "shared",
  "data",
  "schema.sql",
);

/** The statements of shared/data/schema.sql (comments stripped), in order. */
export function readSchemaStatements() {
  const script = fs.readFileSync(SCHEMA_SQL_PATH, "utf8");
  const statements = [];
  let current = [];
  for (const rawLine of script.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim().startsWith("--") || line.trim() === "") continue;
    current.push(line);
    if (line.endsWith(";")) {
      statements.push(current.join("\n"));
      current = [];
    }
  }
  if (current.length) statements.push(current.join("\n"));
  return statements;
}

/** Run the schema script on an open node:sqlite database. */
export function applySchema(db) {
  for (const statement of readSchemaStatements()) db.exec(statement);
}

/**
 * Build an empty database at `outPath`. Any existing file at `outPath` (and
 * its SQLite journal) is replaced.
 *
 * @returns the number of tables created
 */
export function createEmptyDatabase(outPath) {
  for (const f of [outPath, `${outPath}-journal`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const db = new DatabaseSync(outPath);
  try {
    applySchema(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();
    if (tables.length === 0) throw new Error(`${outPath} has no tables — schema script was empty`);
    for (const { name } of tables) {
      if (name === "SchemaVersion") continue;
      const { c } = db.prepare(`SELECT count(*) AS c FROM "${name}"`).get();
      if (c !== 0) throw new Error(`${outPath} table ${name} is not empty (${c} rows)`);
    }
    return tables.length;
  } finally {
    db.close();
  }
}
