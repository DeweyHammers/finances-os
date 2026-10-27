// empty-db.mjs — creates an EMPTY SQLite database with the current Prisma
// schema, without needing any existing database file.
//
// Used by:
//   - scripts/build-template-db.mjs → prisma/template.db, the file the
//     installer ships (a fresh install copies it to %APPDATA%).
//   - main/api-server.routes.test.ts → a throwaway test database. It used to
//     copy prisma/dev.db for the schema, which doesn't exist on a clean
//     checkout (dev.db is gitignored), so the suite failed on GitHub Actions.
//
// How: `prisma migrate diff` prints the CREATE TABLE script for the schema
// (no database needed), and node:sqlite executes it. The result is verified
// to have tables and zero rows before it's handed back.
import { execSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * Build an empty database at `outPath` from `prisma/schema.prisma` (relative
 * to `root`, default: the current working directory). Any existing file at
 * `outPath` (and its SQLite journal) is replaced.
 *
 * @returns the number of tables created
 */
export function createEmptyDatabase(outPath, { root = process.cwd() } = {}) {
  for (const f of [outPath, `${outPath}-journal`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const sql = execSync(
    "npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script",
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );

  const db = new DatabaseSync(outPath);
  try {
    db.exec(sql);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();
    if (tables.length === 0) throw new Error(`${outPath} has no tables — schema script was empty`);
    for (const { name } of tables) {
      const { c } = db.prepare(`SELECT count(*) AS c FROM "${name}"`).get();
      if (c !== 0) throw new Error(`${outPath} table ${name} is not empty (${c} rows)`);
    }
    return tables.length;
  } finally {
    db.close();
  }
}
