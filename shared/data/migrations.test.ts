// @vitest-environment node
/**
 * Schema migrations (shared/data/migrations.ts) on real libsql files in a temp
 * dir. Generic sample data only.
 *
 * The contract: a database made by an OLDER build, opened by this one, ends
 * up with exactly the shape a brand-new database has — same tables, same
 * columns in the same order with the same types / NOT NULL / defaults / keys,
 * same indexes — with every existing row untouched, and the step is safe to
 * repeat. `test-fixtures/schema-v1.sql` is the frozen version-1 schema.sql
 * (the shape of every database before Nov 2026); `schema-v2.sql` is version 2
 * (per-week income, the shape the installed app had until 0.7.0).
 */
import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  DataStore,
  SCHEMA_VERSION,
  createDatabase,
  dumpDatabase,
  getModelByName,
  getSchemaVersion,
  loadDatabase,
  migrationStatements,
  splitStatements,
  type SqlExecutor,
} from "./index";
import { openLibsql } from "./backends/libsql";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "finances-os-migrations-test-"));
const V1_SQL = fs.readFileSync(path.join(__dirname, "test-fixtures", "schema-v1.sql"), "utf8");
const V2_SQL = fs.readFileSync(path.join(__dirname, "test-fixtures", "schema-v2.sql"), "utf8");
let fileCounter = 0;
const newFile = () => path.join(tmpDir, `db-${++fileCounter}.db`);

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** A version-1 database with one income, as the installed app had it. */
async function createV1(db: SqlExecutor): Promise<void> {
  for (const statement of splitStatements(V1_SQL)) await db.exec(statement);
  await db.exec(
    'INSERT INTO "Income" ("id", "name", "amount", "paymentCycle", "payDay", "payWeekOffset", "isPrimary") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ["inc1", "Paycheck", 700, "WEEKLY", 3, 0, 1],
  );
  await db.exec('INSERT INTO "Bill" ("id", "name", "amount", "dueDate") VALUES (?, ?, ?, ?)', ["b1", "Rent", 900, 1]);
}

/** A version-2 database (0.6.0) with an income, one changed paycheck and a bill. */
async function createV2(db: SqlExecutor): Promise<void> {
  for (const statement of splitStatements(V2_SQL)) await db.exec(statement);
  await db.exec(
    'INSERT INTO "Income" ("id", "name", "amount", "paymentCycle", "payDay", "payWeekOffset", "isPrimary", "baseHours") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ["inc1", "Paycheck", 700, "WEEKLY", 3, 0, 1, 40],
  );
  await db.exec('INSERT INTO "IncomeOverride" ("id", "incomeId", "payDate", "amount", "hours") VALUES (?, ?, ?, ?, ?)', ["o1", "inc1", 20261118, 556, 32]);
  await db.exec('INSERT INTO "Bill" ("id", "name", "amount", "dueDate") VALUES (?, ?, ?, ?)', ["b1", "Game pass", 15, 20]);
}

/** Everything that defines a database's shape, in a comparable form. */
async function shapeOf(db: SqlExecutor) {
  const tables = (await db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )).map((r) => String(r.name));
  const shape: Record<string, unknown> = {};
  for (const table of tables) {
    const columns = (await db.exec(`PRAGMA table_info("${table}")`)).map((c) => ({
      name: c.name,
      type: c.type,
      notnull: c.notnull,
      dflt: c.dflt_value,
      pk: c.pk,
    }));
    const foreignKeys = (await db.exec(`PRAGMA foreign_key_list("${table}")`)).map((f) => ({
      table: f.table,
      from: f.from,
      to: f.to,
      onDelete: f.on_delete,
      onUpdate: f.on_update,
    }));
    shape[table] = { columns, foreignKeys };
  }
  const indexes = (await db.exec(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name",
  )).map((i) => ({ name: i.name, table: i.tbl_name, sql: i.sql }));
  return { tables, shape, indexes };
}

describe("migrating a version-1 database", () => {
  it("the fixture really is the old shape (no baseHours, no IncomeOverride)", async () => {
    const db = openLibsql(newFile());
    await createV1(db);
    expect(await getSchemaVersion(db)).toBe(1);
    const { tables, shape } = await shapeOf(db);
    expect(tables).not.toContain("IncomeOverride");
    expect((shape.Income as any).columns.map((c: any) => c.name)).not.toContain("baseHours");
    await db.close();
  });

  it("first use brings it to exactly the shape of a brand-new database, rows untouched", async () => {
    const fresh = openLibsql(newFile());
    await createDatabase(fresh);

    const old = openLibsql(newFile());
    await createV1(old);
    const store = new DataStore(old);
    // Any call is a first use: the migration runs before it.
    const incomes = await store.list(getModelByName("Income"), {});

    expect(await shapeOf(old)).toEqual(await shapeOf(fresh));
    expect(await store.schemaVersion()).toBe(SCHEMA_VERSION);
    // The old row is still there, with the new column empty.
    expect(incomes.items).toEqual([
      { id: "inc1", name: "Paycheck", amount: 700, paymentCycle: "WEEKLY", payDay: 3, payWeekOffset: 0, isPrimary: true, baseHours: null, baseTaxes: null, baseFlatDeductions: null, workWeekStart: null },
    ]);
    expect((await store.list(getModelByName("Bill"), {})).items.map((b) => b.name)).toEqual(["Rent"]);
    // Both stamps are kept: 1 from the old build, this build's on top.
    expect((await old.exec('SELECT "version" FROM "SchemaVersion" ORDER BY "version"')).map((r) => r.version)).toEqual([1, SCHEMA_VERSION]);

    await store.close();
    await fresh.close();
  });

  it("the new table works after the migration, cascade included", async () => {
    const old = openLibsql(newFile());
    await createV1(old);
    const store = new DataStore(old);
    const Override = getModelByName("IncomeOverride");

    const row = await store.create(Override, { incomeId: "inc1", payDate: 20261118, amount: 560, hours: 32 });
    expect(row).toMatchObject({ incomeId: "inc1", payDate: 20261118, amount: 560, hours: 32 });
    // One override per income + payday.
    await expect(store.create(Override, { incomeId: "inc1", payDate: 20261118, amount: 1 })).rejects.toThrow();
    // Deleting the income takes its overrides with it.
    await store.remove(getModelByName("Income"), "inc1");
    expect((await store.list(Override, {})).total).toBe(0);
    await store.close();
  });

  it("is idempotent: a second store on the same file changes nothing", async () => {
    const file = newFile();
    const first = openLibsql(file);
    await createV1(first);
    const store = new DataStore(first);
    await store.schemaVersion();
    const shape = await shapeOf(first);
    expect(await migrationStatements(first)).toEqual([]);
    await store.close();

    const second = openLibsql(file);
    const again = new DataStore(second);
    expect(await again.schemaVersion()).toBe(SCHEMA_VERSION);
    expect(await shapeOf(second)).toEqual(shape);
    expect((await second.exec('SELECT count(*) AS c FROM "SchemaVersion"'))[0].c).toBe(2);
    await again.close();
  });

  it("a file that already has the shape but an old stamp gets only the stamp", async () => {
    // dev.db after `prisma db push`: new column + table, SchemaVersion still 1.
    const db = openLibsql(newFile());
    await createDatabase(db);
    await db.exec('UPDATE "SchemaVersion" SET "version" = 1');
    const before = await shapeOf(db);
    expect(await migrationStatements(db)).toEqual([]);
    const store = new DataStore(db);
    expect(await store.schemaVersion()).toBe(SCHEMA_VERSION);
    expect(await shapeOf(db)).toEqual(before);
    await store.close();
  });

  it("a file that has only part of the new shape gets the rest", async () => {
    // E.g. a database migrated by a build from the middle of this work.
    const db = openLibsql(newFile());
    await createV1(db);
    await db.exec('ALTER TABLE "Income" ADD COLUMN "baseHours" REAL');
    expect(await migrationStatements(db)).toEqual([
      'ALTER TABLE "Income" ADD COLUMN "baseTaxes" REAL',
      'ALTER TABLE "Income" ADD COLUMN "baseFlatDeductions" REAL',
      expect.stringContaining('CREATE TABLE "IncomeOverride"'),
      expect.stringContaining("CREATE UNIQUE INDEX"),
      // … followed by version 3's steps, in order.
      'ALTER TABLE "Income" ADD COLUMN "workWeekStart" INTEGER',
      expect.stringContaining('CREATE TABLE "BillNoCharge"'),
      expect.stringContaining("CREATE UNIQUE INDEX"),
    ]);
    const fresh = openLibsql(newFile());
    await createDatabase(fresh);
    const store = new DataStore(db);
    await store.schemaVersion();
    expect(await shapeOf(db)).toEqual(await shapeOf(fresh));
    await store.close();
    await fresh.close();
  });

  it("is all or nothing: a failing step leaves the file at its old version", async () => {
    const db = openLibsql(newFile());
    await createV1(db);
    // A view already owns the new table's name, so the SECOND step of version
    // 2 fails — after the first (ALTER TABLE Income) has already run.
    await db.exec('CREATE VIEW "IncomeOverride" AS SELECT 1 AS x');
    const before = await shapeOf(db);
    const store = new DataStore(db);
    await expect(store.schemaVersion()).rejects.toThrow();
    // Rolled back: no half-migrated table, no new stamp.
    expect(await shapeOf(db)).toEqual(before);
    expect(await getSchemaVersion(db)).toBe(1);
    await db.close();
  });

  it("nothing to do on an empty database (it gets the whole schema instead)", async () => {
    const db = openLibsql(newFile());
    expect(await migrationStatements(db)).toEqual([]);
    await db.close();
  });
});

describe("migrating a version-2 database", () => {
  it("the fixture really is the 0.6.0 shape (no workWeekStart, no BillNoCharge)", async () => {
    const db = openLibsql(newFile());
    await createV2(db);
    expect(await getSchemaVersion(db)).toBe(2);
    const { tables, shape } = await shapeOf(db);
    expect(tables).toContain("IncomeOverride");
    expect(tables).not.toContain("BillNoCharge");
    expect((shape.Income as any).columns.map((c: any) => c.name)).not.toContain("workWeekStart");
    await db.close();
  });

  it("first use brings it to exactly the shape of a brand-new database, rows untouched", async () => {
    const fresh = openLibsql(newFile());
    await createDatabase(fresh);

    const old = openLibsql(newFile());
    await createV2(old);
    // Only version 3's steps are needed.
    expect(await migrationStatements(old)).toEqual([
      'ALTER TABLE "Income" ADD COLUMN "workWeekStart" INTEGER',
      expect.stringContaining('CREATE TABLE "BillNoCharge"'),
      expect.stringContaining("CREATE UNIQUE INDEX"),
    ]);
    const store = new DataStore(old);
    const incomes = await store.list(getModelByName("Income"), {});

    expect(await shapeOf(old)).toEqual(await shapeOf(fresh));
    expect(await store.schemaVersion()).toBe(SCHEMA_VERSION);
    expect(incomes.items).toEqual([
      { id: "inc1", name: "Paycheck", amount: 700, paymentCycle: "WEEKLY", payDay: 3, payWeekOffset: 0, isPrimary: true, baseHours: 40, baseTaxes: null, baseFlatDeductions: null, workWeekStart: null },
    ]);
    expect((await store.list(getModelByName("IncomeOverride"), {})).items).toEqual([
      { id: "o1", incomeId: "inc1", payDate: 20261118, amount: 556, hours: 32 },
    ]);
    expect((await old.exec('SELECT "version" FROM "SchemaVersion" ORDER BY "version"')).map((r) => r.version)).toEqual([2, SCHEMA_VERSION]);
    // A second look finds nothing left to do.
    expect(await migrationStatements(old)).toEqual([]);

    await store.close();
    await fresh.close();
  });

  it("the new column and table work after the migration, cascade included", async () => {
    const old = openLibsql(newFile());
    await createV2(old);
    const store = new DataStore(old);
    const NoCharge = getModelByName("BillNoCharge");

    // The work week: Sunday (0) is a real value, not "unset".
    const income = await store.update(getModelByName("Income"), "inc1", { workWeekStart: 0 });
    expect(income).toMatchObject({ workWeekStart: 0, baseHours: 40 });

    const row = await store.create(NoCharge, { billId: "b1", dueDateKey: 20261120 });
    expect(row).toMatchObject({ billId: "b1", dueDateKey: 20261120 });
    // One mark per bill + due date.
    await expect(store.create(NoCharge, { billId: "b1", dueDateKey: 20261120 })).rejects.toThrow();
    await store.create(NoCharge, { billId: "b1", dueDateKey: 20261220 });
    // Deleting the bill takes its marks with it.
    await store.remove(getModelByName("Bill"), "b1");
    expect((await store.list(NoCharge, {})).total).toBe(0);
    await store.close();
  });
});

describe("moving data between versions (transfer.ts)", () => {
  it("dumps a version-1 source with this build's columns (new ones NULL) and loads it into a new file", async () => {
    const old = openLibsql(newFile());
    await createV1(old);
    const dump = await dumpDatabase(old);
    expect(dump.schemaVersion).toBe(1);
    const income = dump.tables.find((t) => t.table === "Income")!;
    expect(income.columns).toContain("baseHours");
    expect(income.columns.slice(-4)).toEqual(["baseHours", "baseTaxes", "baseFlatDeductions", "workWeekStart"]);
    expect(income.rows).toEqual([["inc1", "Paycheck", 700, "WEEKLY", 3, 0, 1, null, null, null, null]]);
    expect(dump.tables.find((t) => t.table === "IncomeOverride")!.rows).toEqual([]);
    expect(dump.tables.find((t) => t.table === "BillNoCharge")!.rows).toEqual([]);

    // An old export imported by this build: the target gets this build's
    // tables, the old rows, and — on first use — this build's stamp.
    const target = openLibsql(newFile());
    await loadDatabase(target, dump);
    const store = new DataStore(target);
    expect((await store.list(getModelByName("Income"), {})).items[0]).toMatchObject({ name: "Paycheck", baseHours: null });
    expect(await store.schemaVersion()).toBe(SCHEMA_VERSION);
    await store.close();
    await old.close();
  });
});
