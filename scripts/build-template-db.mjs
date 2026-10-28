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
// The actual work (schema script → SQLite → emptiness check) lives in
// scripts/empty-db.mjs, shared with the API route tests.
import path from "node:path";
import { createEmptyDatabase } from "./empty-db.mjs";

const ROOT = process.cwd();
const TEMPLATE_DB = path.join(ROOT, "prisma", "template.db");

// Guard against ever being pointed at dev.db / PROD.
if (path.basename(TEMPLATE_DB) !== "template.db") {
  throw new Error("refusing: output is not template.db");
}

const tables = createEmptyDatabase(TEMPLATE_DB);

console.log(
  `Empty template database created: ${path.relative(ROOT, TEMPLATE_DB)} (${tables} tables, 0 rows)`,
);
