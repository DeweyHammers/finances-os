// generate-schema-sql.ts — turns prisma/schema.prisma into the data layer's
// DDL files. Run it after EVERY change to the Prisma schema:
//
//   npx tsx scripts/generate-schema-sql.ts
//
// It writes two files under shared/data/:
//   schema.sql     the CREATE TABLE / CREATE INDEX script Prisma itself would
//                  run on an empty database (`prisma migrate diff`), plus the
//                  INSERT that stamps the database with SCHEMA_VERSION. The
//                  installer's template.db, the route tests' temp database and
//                  the demo database are all built from it (scripts/empty-db.mjs).
//   schema-sql.ts  the same text as a TypeScript constant, because the main
//                  process is bundled by webpack and cannot read a .sql file
//                  next to it at runtime (shared/data → createDatabase).
//
// shared/data/schema.test.ts fails when either file is out of date, so a
// forgotten regeneration can't reach main.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_VERSION } from "../shared/data/schema";

const ROOT = path.resolve(__dirname, "..");
const OUT_SQL = path.join(ROOT, "shared", "data", "schema.sql");
const OUT_TS = path.join(ROOT, "shared", "data", "schema-sql.ts");

/** The DDL exactly as Prisma prints it (LF line endings, trimmed). */
export function prismaDdl(root = ROOT): string {
  const sql = execSync(
    "npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script",
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return sql.replace(/\r\n/g, "\n").trim();
}

/** Full schema.sql text for a given DDL + version. */
export function buildSchemaSql(ddl: string, version = SCHEMA_VERSION): string {
  return [
    "-- GENERATED FILE — do not edit. Source: prisma/schema.prisma.",
    "-- Regenerate with: npx tsx scripts/generate-schema-sql.ts",
    "--",
    "-- Creates every table of an EMPTY Finances OS database and stamps it with",
    `-- schema version ${version} (shared/data/schema.ts → SCHEMA_VERSION).`,
    "",
    ddl,
    "",
    "-- SchemaVersion stamp (appliedAt = Unix milliseconds, the DateTime storage",
    "-- format shared with Prisma).",
    `INSERT INTO "SchemaVersion" ("version", "appliedAt") VALUES (${version}, CAST(strftime('%s', 'now') AS INTEGER) * 1000);`,
    "",
  ].join("\n");
}

export function buildSchemaTs(schemaSql: string): string {
  return [
    "// GENERATED FILE — do not edit. Mirrors shared/data/schema.sql so the bundled",
    "// main process can apply the schema without reading a file at runtime.",
    "// Regenerate with: npx tsx scripts/generate-schema-sql.ts",
    "",
    "export const SCHEMA_SQL = " + JSON.stringify(schemaSql) + ";",
    "",
  ].join("\n");
}

if (require.main === module) {
  const sql = buildSchemaSql(prismaDdl());
  fs.writeFileSync(OUT_SQL, sql);
  fs.writeFileSync(OUT_TS, buildSchemaTs(sql));
  console.log(`Wrote ${path.relative(ROOT, OUT_SQL)} and ${path.relative(ROOT, OUT_TS)} (schema version ${SCHEMA_VERSION})`);
}
