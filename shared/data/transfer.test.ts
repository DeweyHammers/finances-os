// @vitest-environment node
/**
 * transfer.ts — dump/load between two throwaway files. Generic sample data
 * only (the repo is public).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DataStore, MODELS, SCHEMA_VERSION, getModelByName } from "./index";
import { openLibsql, type LibsqlConnection } from "./backends/libsql";
import {
  copyDatabase,
  countDataRows,
  dumpDatabase,
  hasNoTables,
  loadDatabase,
  loadStatements,
  schemaVersionGate,
  tablesInFkOrder,
} from "./transfer";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "finances-os-transfer-test-"));
const conns: LibsqlConnection[] = [];
const open = (name: string) => {
  const c = openLibsql(path.join(tmpDir, name));
  conns.push(c);
  return c;
};

afterAll(async () => {
  for (const c of conns) await c.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("tablesInFkOrder", () => {
  it("lists every model once, parents before children", () => {
    const order = tablesInFkOrder().map((m) => m.name);
    expect([...order].sort()).toEqual(MODELS.map((m) => m.name).sort());
    const idx = (n: string) => order.indexOf(n);
    expect(idx("Account")).toBeLessThan(idx("AccountTransaction"));
    expect(idx("Payee")).toBeLessThan(idx("AccountTransaction"));
    expect(idx("BudgetCategoryItem")).toBeLessThan(idx("AccountTransaction"));
    expect(idx("BudgetCategoryGroup")).toBeLessThan(idx("BudgetCategorySubsection"));
    expect(idx("BudgetCategorySubsection")).toBeLessThan(idx("BudgetCategoryItem"));
    expect(idx("Bill")).toBeLessThan(idx("BillSplit"));
    expect(idx("Client")).toBeLessThan(idx("Contract"));
    expect(idx("Contract")).toBeLessThan(idx("ContractEntry"));
  });
});

describe("dump → load", () => {
  let source: DataStore;
  let sourceConn: LibsqlConnection;

  beforeAll(async () => {
    sourceConn = open("source.db");
    source = new DataStore(sourceConn);
    const account = await source.create(getModelByName("Account"), { name: "Checking", sortOrder: 0 });
    const payee = await source.create(getModelByName("Payee"), { name: "Grocer" });
    const group = await source.create(getModelByName("BudgetCategoryGroup"), { name: "Needs", sortOrder: 0 });
    const item = await source.create(getModelByName("BudgetCategoryItem"), {
      groupId: group.id,
      name: "Food",
      sortOrder: 0,
      sourceType: "CUSTOM",
      customAmountCents: 40000,
    });
    // A child that references three parents, a date, a NULL and a boolean.
    await source.create(getModelByName("AccountTransaction"), {
      accountId: account.id,
      payeeId: payee.id,
      categoryItemId: item.id,
      date: "2026-10-02T00:00:00.000Z",
      memo: null,
      inflowCents: 0,
      outflowCents: 1234,
      cleared: true,
    });
    await source.create(getModelByName("Bill"), { name: "Rent", amount: 950.5, dueDate: 1 });
  });

  it("round-trips every table byte-for-byte, parents first, into an empty file", async () => {
    const target = open("target.db");
    expect(await hasNoTables(target)).toBe(true);
    const dump = await copyDatabase({ exec: (sql, p) => source.raw(sql, p) }, target);
    expect(dump.schemaVersion).toBe(SCHEMA_VERSION);
    expect(countDataRows(dump)).toBe(6);
    expect(await hasNoTables(target)).toBe(false);

    const again = await dumpDatabase(target);
    expect(again).toEqual(dump);
    // The stored representations survive: a DateTime is still Unix ms, a boolean 0/1.
    const txn = again.tables.find((t) => t.table === "AccountTransaction")!;
    const date = txn.rows[0][txn.columns.indexOf("date")];
    expect(typeof date).toBe("number");
    expect(txn.rows[0][txn.columns.indexOf("cleared")]).toBe(1);
    expect(txn.rows[0][txn.columns.indexOf("memo")]).toBeNull();
    // And the data layer reads the copy like the original.
    const copy = new DataStore(target);
    const list = await copy.list(getModelByName("AccountTransaction"));
    expect(list.total).toBe(1);
    expect((list.items[0].date as Date).toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });

  it("replaces whatever the target held, and rolls back as a whole on failure", async () => {
    const target = open("replace.db");
    const stale = new DataStore(target);
    await stale.create(getModelByName("Bill"), { name: "Old", amount: 1, dueDate: 2 });
    await stale.create(getModelByName("Payee"), { name: "Old payee" });

    const dump = await dumpDatabase({ exec: (sql, p) => source.raw(sql, p) });
    await loadDatabase(target, dump);
    expect((await stale.list(getModelByName("Bill"))).items.map((b) => b.name)).toEqual(["Rent"]);
    expect((await stale.list(getModelByName("Payee"))).items.map((p) => p.name)).toEqual(["Grocer"]);

    // Loading again onto a populated target (DDL is IF NOT EXISTS) is a no-op.
    await loadDatabase(target, dump);
    expect((await stale.list(getModelByName("Bill"))).total).toBe(1);

    // A dump with a dangling foreign key fails at COMMIT and leaves the target untouched.
    const broken = JSON.parse(JSON.stringify(dump)) as typeof dump;
    const txn = broken.tables.find((t) => t.table === "AccountTransaction")!;
    txn.rows[0][txn.columns.indexOf("accountId")] = "no-such-account";
    await expect(loadDatabase(target, broken)).rejects.toThrow(/FOREIGN KEY/i);
    expect((await stale.list(getModelByName("AccountTransaction"))).total).toBe(1);
    expect((await stale.list(getModelByName("Bill"))).items.map((b) => b.name)).toEqual(["Rent"]);
  });

  it("emits idempotent DDL, deletes children first and inserts parents first", async () => {
    const dump = await dumpDatabase({ exec: (sql, p) => source.raw(sql, p) });
    const without = loadStatements(dump);
    const ddl = without.filter((s) => /^CREATE/.test(s.sql));
    expect(ddl.length).toBeGreaterThan(MODELS.length);
    expect(ddl.every((s) => /^CREATE (TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS "/.test(s.sql))).toBe(true);
    const deletes = without.filter((s) => s.sql.startsWith("DELETE")).map((s) => s.sql);
    const inserts = without.filter((s) => s.sql.startsWith("INSERT")).map((s) => s.sql);
    expect(deletes.findIndex((s) => s.includes('"AccountTransaction"'))).toBeLessThan(
      deletes.findIndex((s) => s.includes('"Account"')),
    );
    expect(inserts.findIndex((s) => s.includes('"Account"'))).toBeLessThan(
      inserts.findIndex((s) => s.includes('"AccountTransaction"')),
    );
    // Multi-row inserts carry one `?` per value.
    const bills = without.find((s) => s.sql.includes('INSERT INTO "Bill"'))!;
    expect(bills.args).toHaveLength(getModelByName("Bill").columns.length);
  });
});

describe("schemaVersionGate", () => {
  it("accepts the current and older versions, refuses newer ones", () => {
    expect(schemaVersionGate(0)).toBeNull();
    expect(schemaVersionGate(SCHEMA_VERSION)).toBeNull();
    expect(schemaVersionGate(SCHEMA_VERSION + 1)).toMatch(/update the app/i);
  });
});
