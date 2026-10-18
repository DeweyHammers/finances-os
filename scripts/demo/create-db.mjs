// create-db.mjs — builds a brand-new, EMPTY demo database at prisma/demo.db.
//
// The demo tour (docs/) is captured from this database, never from dev.db or
// PROD. It is rebuilt from prisma/schema.prisma every time, so it always has
// the current columns and zero rows: exactly what a first-time user sees.
//
//   node scripts/demo/create-db.mjs
//
// Safety: the only file this script writes or deletes is prisma/demo.db
// (+ its journal). It is gitignored by the `*.db` rule.
import { execSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEMO_DB = path.join(ROOT, "prisma", "demo.db");

// Guard against ever being pointed at the real databases.
if (path.basename(DEMO_DB) !== "demo.db") throw new Error("refusing: not demo.db");

// Ask Prisma for the CREATE TABLE script of the current schema (no DB needed).
const sql = execSync(
  "npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script",
  { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
);

// Reset IN PLACE (drop every table, then recreate) rather than deleting the
// file: on Windows the demo API server (serve.ts) keeps it open, and an
// in-place reset lets a capture run start from empty without restarting it.
const db = new DatabaseSync(DEMO_DB);
db.exec("PRAGMA foreign_keys = OFF");
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all();
for (const { name } of tables) db.exec(`DROP TABLE "${name}"`);
db.exec(sql);
db.exec("PRAGMA foreign_keys = ON");
db.close();

console.log(`Empty demo database created: ${path.relative(ROOT, DEMO_DB)}`);
