// build-template-db.mjs — builds the EMPTY database the installer ships.
//
// A fresh install has no database yet, so on first launch shared/prisma.ts
// copies a template into %APPDATA%\finances-os\database.db. That template
// MUST be empty: the installer is distributed publicly, and until Oct 2026 it
// bundled prisma/dev.db — the developer's real bills and transactions.
//
//   node scripts/build-template-db.mjs      (runs automatically as `prebuild`)
//
// Output: prisma/template.db — current schema, zero rows. Rebuilt from
// prisma/schema.prisma on every build so it always has the latest columns.
// Gitignored by the `*.db` rule; electron-builder.yml packages it.
//
// Safety: the only file this script writes or deletes is prisma/template.db
// (+ its journal), and it refuses to run if the output name is anything else.
import { execSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TEMPLATE_DB = path.join(ROOT, "prisma", "template.db");

// Guard against ever being pointed at dev.db / PROD.
if (path.basename(TEMPLATE_DB) !== "template.db") {
  throw new Error("refusing: output is not template.db");
}

// Start from nothing — unlike demo.db, nothing holds this file open.
for (const f of [TEMPLATE_DB, `${TEMPLATE_DB}-journal`]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

// Ask Prisma for the CREATE TABLE script of the current schema (no DB needed).
const sql = execSync(
  "npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script",
  { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
);

const db = new DatabaseSync(TEMPLATE_DB);
db.exec(sql);

// Belt and braces: prove every table is empty before the build packages it.
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all();
if (tables.length === 0) throw new Error("template.db has no tables — schema script was empty");
for (const { name } of tables) {
  const { c } = db.prepare(`SELECT count(*) AS c FROM "${name}"`).get();
  if (c !== 0) throw new Error(`template.db table ${name} is not empty (${c} rows)`);
}
db.close();

console.log(
  `Empty template database created: ${path.relative(ROOT, TEMPLATE_DB)} (${tables.length} tables, 0 rows)`,
);
