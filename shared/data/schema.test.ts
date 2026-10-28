// @vitest-environment node
/**
 * Keeps the three descriptions of the schema in step:
 *   prisma/schema.prisma  →  shared/data/schema.sql (+ schema-sql.ts)  →  schema.ts
 *
 * 1. schema.sql must be what `prisma migrate diff` prints for schema.prisma
 *    right now (someone edited the Prisma schema and forgot to regenerate).
 * 2. schema-sql.ts must embed schema.sql verbatim (the bundled main process
 *    reads the constant, not the file).
 * 3. The hand-written MODELS metadata must match the DDL column for column:
 *    same tables, same column order, same type, nullability and generated
 *    defaults — those decide how every value is validated and stored.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { MODELS, SCHEMA_SQL, SCHEMA_VERSION, splitStatements, type Column } from "./index";
import { buildSchemaSql, prismaDdl } from "../../scripts/generate-schema-sql";

const ROOT = path.resolve(__dirname, "..", "..");
const schemaSql = fs.readFileSync(path.join(ROOT, "shared", "data", "schema.sql"), "utf8").replace(/\r\n/g, "\n");

describe("schema.sql", () => {
  it("is what prisma migrate diff prints for prisma/schema.prisma", () => {
    expect(schemaSql).toBe(buildSchemaSql(prismaDdl(ROOT)));
  }, 60_000);

  it("is embedded verbatim in schema-sql.ts", () => {
    expect(SCHEMA_SQL.replace(/\r\n/g, "\n")).toBe(schemaSql);
  });

  it("stamps the current SCHEMA_VERSION", () => {
    expect(schemaSql).toContain(`INSERT INTO "SchemaVersion" ("version", "appliedAt") VALUES (${SCHEMA_VERSION},`);
  });
});

/** Parse `CREATE TABLE "X" ( …columns… )` statements into the MODELS shape. */
function columnsFromDdl(): Map<string, Column[]> {
  const tables = new Map<string, Column[]>();
  for (const statement of splitStatements(schemaSql)) {
    const m = /^CREATE TABLE "(\w+)" \(([\s\S]*)\);$/.exec(statement);
    if (!m) continue;
    const columns: Column[] = [];
    for (const rawLine of m[2].split("\n")) {
      const line = rawLine.trim().replace(/,$/, "");
      const col = /^"(\w+)" (TEXT|INTEGER|REAL|BOOLEAN|DATETIME)(.*)$/.exec(line);
      if (!col) continue; // CONSTRAINT … lines
      const [, name, sqlType, rest] = col;
      const type = ({ TEXT: "String", INTEGER: "Int", REAL: "Float", BOOLEAN: "Boolean", DATETIME: "DateTime" } as const)[
        sqlType as "TEXT" | "INTEGER" | "REAL" | "BOOLEAN" | "DATETIME"
      ];
      const nullable = !rest.includes("NOT NULL");
      const hasDefault = /DEFAULT/.test(rest);
      const entry: Column = { name, type, nullable };
      if (rest.includes("DEFAULT CURRENT_TIMESTAMP")) entry.generated = "now";
      else if (rest.includes("PRIMARY KEY") && sqlType === "TEXT" && !hasDefault) entry.generated = "cuid";
      columns.push(entry);
    }
    tables.set(m[1], columns);
  }
  return tables;
}

describe("MODELS metadata", () => {
  const ddl = columnsFromDdl();

  it("lists exactly the tables in the DDL, in order", () => {
    expect(MODELS.map((m) => m.name)).toEqual(Array.from(ddl.keys()));
  });

  it.each(MODELS.map((m) => [m.name, m] as const))("%s has the DDL's columns, types, nullability and defaults", (_name, model) => {
    expect(model.columns).toEqual(ddl.get(model.name));
    expect(model.idColumn).toBe(model.columns[0].name);
  });

  it("marks only SchemaVersion as internal", () => {
    expect(MODELS.filter((m) => m.internal).map((m) => m.name)).toEqual(["SchemaVersion"]);
  });
});
