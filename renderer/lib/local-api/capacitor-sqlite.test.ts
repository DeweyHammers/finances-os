// @vitest-environment node
/**
 * The phone backend's statement handling, checked against REAL SQLite: the
 * fake plugin connection below records every call the wrapper makes and
 * forwards it to a libsql file, so the SQL the RETURNING emulation builds has
 * to be valid, and the whole DataStore has to work on top of it the way it
 * works on the desktop. What the fake pins:
 *   - BEGIN / COMMIT / ROLLBACK go through the plugin's transaction methods,
 *     never through run()
 *   - run() never sees a RETURNING clause and always gets transaction=false
 *   - DDL goes through execute(), reads through query()
 *   - persist (web store save) fires after a write outside a transaction and
 *     after COMMIT, never inside a transaction
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "libsql";
import { DataStore, getModelByName } from "../../../shared/data";
import { collectGarbage } from "../../../shared/data/backends/libsql";
import {
  countPlaceholders,
  insertedKey,
  parseWrite,
  splitReturning,
  wrapPluginConnection,
  type PluginConnection,
} from "./capacitor-sqlite";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "finances-os-phone-test-"));
const openFiles: Database.Database[] = [];
afterAll(async () => {
  // libsql keeps the file handle until the Database is closed AND its
  // statements are collected (see shared/data/backends/libsql.ts), so the
  // removal is best effort: a leftover temp dir is harmless.
  for (const db of openFiles) db.close();
  collectGarbage();
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* Windows may still hold a handle; the OS temp dir cleans up */
  }
});

interface Call {
  method: "query" | "run" | "execute" | "begin" | "commit" | "rollback";
  sql?: string;
  values?: unknown[];
  transaction?: boolean;
  returnMode?: string;
}

/** A plugin connection on a real file that remembers what it was asked. */
function fakePlugin(file: string) {
  const db = new Database(file);
  openFiles.push(db);
  const calls: Call[] = [];
  const connection: PluginConnection = {
    async query(statement, values = []) {
      calls.push({ method: "query", sql: statement, values });
      return { values: db.prepare(statement).all(...(values as never[])) as unknown[] };
    },
    async run(statement, values = [], transaction, returnMode) {
      calls.push({ method: "run", sql: statement, values, transaction, returnMode });
      // The real plugin would strip a RETURNING clause here; the wrapper must
      // have done it already, so the statement is executed verbatim.
      const rows = db.prepare(statement).all(...(values as never[])) as unknown[];
      return { changes: { changes: 1, lastId: 0, values: rows } };
    },
    async execute(statements, transaction) {
      calls.push({ method: "execute", sql: statements, transaction });
      db.exec(statements);
      return {};
    },
    async beginTransaction() {
      calls.push({ method: "begin" });
      db.exec("BEGIN");
      return {};
    },
    async commitTransaction() {
      calls.push({ method: "commit" });
      db.exec("COMMIT");
      return {};
    },
    async rollbackTransaction() {
      calls.push({ method: "rollback" });
      db.exec("ROLLBACK");
      return {};
    },
    async close() {
      db.close();
    },
  };
  return { connection, calls, db };
}

let n = 0;
const freshFile = () => path.join(tmpDir, `phone-${++n}.db`);

describe("RETURNING emulation helpers", () => {
  it("splits the clause off the statement", () => {
    expect(splitReturning('INSERT INTO "Bill" ("name") VALUES (?) RETURNING "id", "name"')).toEqual({
      body: 'INSERT INTO "Bill" ("name") VALUES (?)',
      columns: '"id", "name"',
    });
    expect(splitReturning('SELECT "id" FROM "Bill"')).toBeNull();
    // A column that merely contains the word is not a clause.
    expect(splitReturning('UPDATE "T" SET "returningFlag" = 1 WHERE "id" = ?')).toBeNull();
  });

  it("recognises the three write shapes the store emits", () => {
    expect(parseWrite('INSERT INTO "Bill" ("a") VALUES (?)')).toEqual({ kind: "INSERT", table: '"Bill"', where: null });
    expect(parseWrite('INSERT INTO "Bill" DEFAULT VALUES')).toEqual({ kind: "INSERT", table: '"Bill"', where: null });
    expect(parseWrite('UPDATE "Bill" SET "a" = ?, "b" = ? WHERE "id" = ?')).toEqual({
      kind: "UPDATE",
      table: '"Bill"',
      where: '"id" = ?',
    });
    expect(parseWrite('DELETE FROM "Bill" WHERE "id" = ?')).toEqual({ kind: "DELETE", table: '"Bill"', where: '"id" = ?' });
    expect(() => parseWrite('SELECT 1')).toThrow(/only emulated/);
  });

  it("finds the inserted row's key among the parameters", () => {
    expect(insertedKey('INSERT INTO "Bill" ("name", "id", "amount") VALUES (?, ?, ?)', '"id", "name"')).toEqual({
      column: '"id"',
      index: 1,
    });
    expect(insertedKey('INSERT INTO "Bill" ("name") VALUES (?)', '"id", "name"')).toBeNull();
    expect(insertedKey('INSERT INTO "Bill" DEFAULT VALUES', '"id"')).toBeNull();
    // A literal in VALUES shifts the positions: not mapped.
    expect(insertedKey('INSERT INTO "Bill" ("id", "n") VALUES (?, 1)', '"id"')).toBeNull();
  });

  it("counts the placeholders a WHERE clause binds", () => {
    expect(countPlaceholders('"id" = ?')).toBe(1);
    expect(countPlaceholders('"a" = ? AND "b" IN (?, ?)')).toBe(3);
    expect(countPlaceholders('"a" = 1')).toBe(0);
  });
});

describe("statement routing", () => {
  let fake: ReturnType<typeof fakePlugin>;
  let persisted: number;
  let conn: ReturnType<typeof wrapPluginConnection>;

  beforeEach(async () => {
    fake = fakePlugin(freshFile());
    persisted = 0;
    conn = wrapPluginConnection(fake.connection, {
      persist: async () => {
        persisted++;
      },
    });
    await conn.exec('CREATE TABLE "T" ("id" TEXT PRIMARY KEY, "name" TEXT, "n" INTEGER)');
    fake.calls.length = 0;
    persisted = 0;
  });

  it("DDL → execute, reads → query, PRAGMA settings → execute, PRAGMA questions → query", async () => {
    await conn.exec('CREATE INDEX "T_name" ON "T" ("name")');
    await conn.exec("PRAGMA foreign_keys = ON");
    const fk = await conn.exec("PRAGMA foreign_keys");
    expect(fk).toEqual([{ foreign_keys: 1 }]);
    expect(await conn.exec('SELECT count(*) AS c FROM "T"')).toEqual([{ c: 0 }]);
    expect(fake.calls.map((c) => c.method)).toEqual(["execute", "execute", "query", "query"]);
    expect(fake.calls[0].transaction).toBe(false);
  });

  it("INSERT … RETURNING: the write without the clause, then the row by the key the caller supplied", async () => {
    const rows = await conn.exec('INSERT INTO "T" ("name", "id", "n") VALUES (?, ?, ?) RETURNING "id", "name", "n"', [
      "Alpha",
      "a1",
      7,
    ]);
    expect(rows).toEqual([{ id: "a1", name: "Alpha", n: 7 }]);
    expect(fake.calls).toEqual([
      {
        method: "run",
        sql: 'INSERT INTO "T" ("name", "id", "n") VALUES (?, ?, ?)',
        values: ["Alpha", "a1", 7],
        transaction: false,
        returnMode: "no",
      },
      { method: "query", sql: 'SELECT "id", "name", "n" FROM "T" WHERE "id" = ?', values: ["a1"] },
    ]);
    expect(persisted).toBe(1);
  });

  it("INSERT … RETURNING without the key among the columns falls back to last_insert_rowid()", async () => {
    const rows = await conn.exec('INSERT INTO "T" ("name") VALUES (?) RETURNING "id", "name"', ["Nameless"]);
    expect(rows).toEqual([{ id: null, name: "Nameless" }]);
    expect(fake.calls[1]).toEqual({
      method: "query",
      sql: 'SELECT "id", "name" FROM "T" WHERE rowid = last_insert_rowid()',
      values: [],
    });
  });

  it("UPDATE … RETURNING: the write, then the statement's own WHERE with its parameters", async () => {
    await conn.exec('INSERT INTO "T" ("id", "name", "n") VALUES (?, ?, ?)', ["a1", "Alpha", 1]);
    await conn.exec('INSERT INTO "T" ("id", "name", "n") VALUES (?, ?, ?)', ["b2", "Beta", 2]);
    fake.calls.length = 0;
    const rows = await conn.exec('UPDATE "T" SET "name" = ?, "n" = ? WHERE "id" = ? RETURNING "id", "name", "n"', [
      "Alpha 2",
      11,
      "a1",
    ]);
    expect(rows).toEqual([{ id: "a1", name: "Alpha 2", n: 11 }]);
    expect(fake.calls[0]).toMatchObject({ method: "run", sql: 'UPDATE "T" SET "name" = ?, "n" = ? WHERE "id" = ?', values: ["Alpha 2", 11, "a1"] });
    expect(fake.calls[1]).toEqual({ method: "query", sql: 'SELECT "id", "name", "n" FROM "T" WHERE "id" = ?', values: ["a1"] });
    // A missing row returns no rows (the store turns that into NOT_FOUND).
    expect(await conn.exec('UPDATE "T" SET "n" = ? WHERE "id" = ? RETURNING "id"', [0, "nope"])).toEqual([]);
  });

  it("DELETE … RETURNING: reads the rows first, then deletes", async () => {
    await conn.exec('INSERT INTO "T" ("id", "name", "n") VALUES (?, ?, ?)', ["a1", "Alpha", 1]);
    fake.calls.length = 0;
    expect(await conn.exec('DELETE FROM "T" WHERE "id" = ? RETURNING "id"', ["a1"])).toEqual([{ id: "a1" }]);
    expect(fake.calls.map((c) => c.method)).toEqual(["query", "run"]);
    expect(fake.calls[0]).toMatchObject({ sql: 'SELECT "id" FROM "T" WHERE "id" = ?', values: ["a1"] });
    expect(await conn.exec('SELECT count(*) AS c FROM "T"')).toEqual([{ c: 0 }]);
    expect(await conn.exec('DELETE FROM "T" WHERE "id" = ? RETURNING "id"', ["a1"])).toEqual([]);
  });

  it("maps BEGIN / COMMIT / ROLLBACK to the plugin's transaction methods and persists only at COMMIT", async () => {
    await conn.exec("BEGIN");
    await conn.exec('INSERT INTO "T" ("id") VALUES (?)', ["x"]);
    expect(persisted).toBe(0);
    await conn.exec("COMMIT");
    expect(persisted).toBe(1);
    await conn.exec("BEGIN");
    await conn.exec('INSERT INTO "T" ("id") VALUES (?)', ["y"]);
    await conn.exec("ROLLBACK");
    expect(persisted).toBe(1);
    expect(await conn.exec('SELECT "id" FROM "T"')).toEqual([{ id: "x" }]);
    expect(fake.calls.filter((c) => c.method === "run").every((c) => c.transaction === false)).toBe(true);
    expect(fake.calls.map((c) => c.method)).toEqual(["begin", "run", "commit", "begin", "run", "rollback", "query"]);
  });

  it("binds bigint parameters as numbers", async () => {
    await conn.exec('INSERT INTO "T" ("id", "n") VALUES (?, ?)', ["big", BigInt("1761782400000")]);
    expect(fake.calls[0].values).toEqual(["big", 1761782400000]);
    expect(await conn.exec('SELECT "n" FROM "T"')).toEqual([{ n: 1761782400000 }]);
  });
});

describe("DataStore on the phone backend", () => {
  it("creates the schema, runs the CRUD and the transactional rules", async () => {
    const fake = fakePlugin(freshFile());
    const store = new DataStore(wrapPluginConnection(fake.connection));

    // First use applies schema.sql (through execute) and stamps the version.
    expect(await store.schemaVersion()).toBe(1);
    expect(fake.calls.filter((c) => c.method === "execute").length).toBeGreaterThan(5);

    const Bill = getModelByName("Bill");
    const bill = await store.create(Bill, { name: "Sample Streaming", amount: "12.50", dueDate: "15" });
    expect(bill).toMatchObject({ name: "Sample Streaming", amount: 12.5, dueDate: 15, isAutoPay: true });
    expect(typeof bill.id).toBe("string");
    expect((bill.id as string).length).toBe(25); // a cuid, generated by the store

    const updated = await store.update(Bill, bill.id as string, { amount: 29.99 });
    expect(updated).toMatchObject({ id: bill.id, amount: 29.99 });
    await expect(store.update(Bill, "missing", { amount: 1 })).rejects.toThrow(/not found/i);

    // Income's single-primary rule runs in BEGIN … COMMIT on the plugin's methods.
    const Income = getModelByName("Income");
    const a = await store.create(Income, { name: "Day job", amount: 700, isPrimary: true });
    const b = await store.create(Income, { name: "Side gig", amount: 100, isPrimary: true });
    expect((await store.getOne(Income, a.id as string))?.isPrimary).toBe(false);
    expect((await store.getOne(Income, b.id as string))?.isPrimary).toBe(true);
    expect(fake.calls.filter((c) => c.method === "commit").length).toBeGreaterThanOrEqual(2);

    // A failing write inside a transaction rolls back.
    const BillSplit = getModelByName("BillSplit");
    const row = { billId: bill.id, monthKey: "2026-10", weekIndex: 0, amountCents: 3000, occurrenceCoord: 31 };
    await store.create(BillSplit, row);
    await expect(store.create(BillSplit, row)).rejects.toThrow(/UNIQUE/);
    expect((await store.list(BillSplit)).total).toBe(1);

    await store.remove(Bill, bill.id as string);
    expect(await store.getOne(Bill, bill.id as string)).toBeNull();
    // ON DELETE CASCADE needs foreign keys ON — the fake's libsql file has
    // them off by default, exactly like the plugin, so openPhoneDatabase sets
    // the PRAGMA; here we only check the delete itself went through.
    await expect(store.remove(Bill, bill.id as string)).rejects.toThrow(/does not exist/);
  });
});
