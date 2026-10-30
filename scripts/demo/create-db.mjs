// create-db.mjs — builds a brand-new, EMPTY demo database at prisma/demo/demo.db.
//
// The demo tour (docs/) is captured from this database, never from dev.db or
// PROD. It is rebuilt from shared/data/schema.sql (generated from
// prisma/schema.prisma) every time, so it always has the current columns and
// zero rows: exactly what a first-time user sees.
//
//   node scripts/demo/create-db.mjs
//
// Safety: the only file this script writes or deletes is prisma/demo/demo.db
// (+ its journal). The whole prisma/demo/ folder is gitignored: the demo app
// keeps its sync.json and replica files there too during the tour's sync
// step, so they can never be mistaken for dev.db's (which live in prisma/).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { applySchema } from "../empty-db.mjs";

const ROOT = process.cwd();
const DEMO_DB = path.join(ROOT, "prisma", "demo", "demo.db");
fs.mkdirSync(path.dirname(DEMO_DB), { recursive: true });

// Guard against ever being pointed at the real databases.
if (path.basename(DEMO_DB) !== "demo.db") throw new Error("refusing: not demo.db");

// Reset IN PLACE (drop every table, then recreate) rather than deleting the
// file: on Windows the demo API server (serve.ts) keeps it open, and an
// in-place reset lets a capture run start from empty without restarting it.
const db = new DatabaseSync(DEMO_DB);
db.exec("PRAGMA foreign_keys = OFF");
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all();
for (const { name } of tables) db.exec(`DROP TABLE "${name}"`);
applySchema(db);
db.exec("PRAGMA foreign_keys = ON");
db.close();

console.log(`Empty demo database created: ${path.relative(ROOT, DEMO_DB)}`);
