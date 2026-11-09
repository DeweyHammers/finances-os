/**
 * spike.ts — SPIKE page (plans/phone-app.md, step 1a). Throwaway UI around
 * turso-executor.ts: it proves, from a real browser, that the phone's
 * planned data path works —
 *   - a cross-origin request to the cloud database gets through (CORS),
 *   - the shared DataStore runs unchanged on the executor: a create is one
 *     autocommitted INSERT … RETURNING, an update one UPDATE … RETURNING, a
 *     remove an interactive transaction (BEGIN, DELETE … RETURNING, COMMIT),
 *   - and how long a bundled read takes.
 *
 * Rules it keeps (they are the phone app's rules too):
 *   - The URL and token live in two inputs and nowhere else. No storage, no
 *     logging of the token.
 *   - The schema gate runs BEFORE the data layer sees the connection.
 *     `DataStore` calls `prepareDatabase` on first use, which CREATES the
 *     schema in an empty database and STAMPS a newer version into an older
 *     one — right for the desktop's own file, never for a phone pointed at a
 *     cloud database. So: no tables, or a version other than this build's →
 *     stop, write nothing.
 *   - The only row it ever writes is a Payee named "Phone spike test …".
 */
import { DataStore, MODELS, SCHEMA_VERSION, getSchemaVersion, resolveModel, type Model } from "../../shared/data";
import { openTurso, type TursoConnection } from "./turso-executor";

const TEST_PAYEE_PREFIX = "Phone spike test";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const urlInput = $<HTMLInputElement>("url");
const tokenInput = $<HTMLInputElement>("token");
const target = $<HTMLSpanElement>("target");
const logBox = $<HTMLPreElement>("log");
const buttons = {
  read: $<HTMLButtonElement>("read"),
  add: $<HTMLButtonElement>("add"),
  rename: $<HTMLButtonElement>("rename"),
  remove: $<HTMLButtonElement>("remove"),
};

// ── Log ──

function line(text: string, cls = ""): void {
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = `${text}\n`;
  logBox.appendChild(span);
  logBox.scrollTop = logBox.scrollHeight;
}
const ok = (text: string) => line(`✔ ${text}`, "ok");
const bad = (text: string) => line(`✘ ${text}`, "bad");
const note = (text: string) => line(`  ${text}`, "dim");

/** Run one step, report how long it took, rethrow on failure. */
async function timed<T>(label: string, fn: () => Promise<T>, describe?: (value: T) => string): Promise<T> {
  const start = performance.now();
  try {
    const value = await fn();
    const ms = Math.round(performance.now() - start);
    ok(`${label} — ${ms} ms${describe ? ` · ${describe(value)}` : ""}`);
    return value;
  } catch (e) {
    bad(`${label} — ${explain(e)}`);
    throw e;
  }
}

/** An error in words, with the usual meaning of the browser's vague ones. */
function explain(e: unknown): string {
  const err = e as { message?: string; code?: string; cause?: { message?: string } };
  const message = err?.message ?? String(e);
  const parts = [err?.code ? `[${err.code}] ${message}` : message];
  if (err?.cause?.message && err.cause.message !== message) parts.push(`cause: ${err.cause.message}`);
  if (/failed to fetch|networkerror|load failed/i.test(parts.join(" "))) {
    parts.push("→ the browser could not complete the request: the host is unreachable, or it does not allow this page's origin (CORS)");
  }
  return parts.join(" · ");
}

// ── Connection ──

let current: { key: string; conn: TursoConnection; store: DataStore | null } | null = null;

function isMock(url: string): boolean {
  try {
    const host = new URL(url.replace(/^libsql:/, "https:")).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

function showTarget(): void {
  const url = urlInput.value.trim();
  if (!url) {
    target.textContent = "nothing yet";
    target.className = "dim";
    return;
  }
  let host = url;
  try {
    host = new URL(url.replace(/^libsql:/, "https:")).host;
  } catch {
    /* shown as typed */
  }
  target.textContent = isMock(url) ? `${host} — the local mock (fake data)` : `${host} — a REAL database`;
  target.className = isMock(url) ? "mock" : "real";
}

/** The connection for what is in the two inputs; a change of either starts over. */
async function connection(): Promise<NonNullable<typeof current>> {
  const url = urlInput.value.trim();
  const token = tokenInput.value.trim();
  if (!url) throw new Error("Enter the database URL first.");
  const key = `${url}\n${token}`;
  if (current?.key !== key) {
    if (current) await current.conn.close();
    current = { key, conn: openTurso(url, token), store: null };
    setWriteButtons(false);
  }
  return current;
}

function setWriteButtons(enabled: boolean): void {
  buttons.add.disabled = !enabled;
  buttons.rename.disabled = !enabled;
  buttons.remove.disabled = !enabled;
}

function model(name: string): Model {
  const m = resolveModel(name);
  if (!m) throw new Error(`The data layer has no model "${name}".`);
  return m;
}

/** The store, only once the schema gate has passed on this connection. */
function store(): DataStore {
  if (!current?.store) throw new Error("Run the read checks first.");
  return current.store;
}

// ── Steps ──

async function readChecks(): Promise<void> {
  line(`── Read checks · page origin ${location.origin} ──`);
  const c = await connection();
  c.store = null;
  setWriteButtons(false);
  const { conn } = c;

  await timed("First request (SELECT 1, includes the connection)", () => conn.exec("SELECT 1 AS one"));
  await timed("Second request (SELECT 1)", () => conn.exec("SELECT 1 AS one"));

  // The gate, on the bare connection — before any DataStore exists.
  const tables = await timed(
    "Tables in the database",
    () => conn.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"),
    (rows) => `${rows.length} tables`,
  );
  if (tables.length === 0) {
    bad("This database is empty — it holds no Finances OS data. Nothing was written. Stopping.");
    return;
  }
  const version = await timed("Schema version", () => getSchemaVersion(conn), (v) => `cloud ${v}, this build ${SCHEMA_VERSION}`);
  if (version !== SCHEMA_VERSION) {
    bad(
      version > SCHEMA_VERSION
        ? "The cloud database was written by a NEWER app than this page. Read-only: writes stay disabled."
        : "The cloud database is OLDER than this page (or was never stamped). Read-only: writes stay disabled.",
    );
    return;
  }

  // One round trip for what a screen needs: every table's row count.
  const names = MODELS.map((m) => m.name);
  const counts = await timed(
    `One bundled read (${names.length} statements in one request)`,
    () => conn.client.batch(names.map((n) => `SELECT count(*) AS n FROM "${n}"`), "read"),
    (results) => `${results.reduce((sum, r) => sum + Number(r.rows[0]?.n ?? 0), 0)} rows in all`,
  );
  note(names.map((n, i) => `${n} ${Number(counts[i].rows[0]?.n ?? 0)}`).join(" · "));

  // And through the data layer itself (its first use runs the bookkeeping
  // check, which is a no-op now that the versions match).
  const checked = new DataStore(conn);
  await timed("List through the shared data layer (Account)", () => checked.list(model("Account")), (r) => `${r.total} accounts`);
  await timed(
    "Test payees left over from an earlier run",
    () => checked.list(model("Payee"), { name_like: TEST_PAYEE_PREFIX }),
    (r) => `${r.total}`,
  );

  // Only now does the page hold a store: every check above passed.
  c.store = checked;
  ok("Read checks passed. The write test is unlocked.");
}

async function testPayees(): Promise<{ id: string; name: string }[]> {
  const found = await store().list(model("Payee"), { name_like: TEST_PAYEE_PREFIX });
  return found.items
    .map((row) => ({ id: String(row.id), name: String(row.name) }))
    .filter((p) => p.name.startsWith(TEST_PAYEE_PREFIX));
}

async function addPayee(): Promise<void> {
  line("── Add (one autocommitted INSERT … RETURNING) ──");
  const name = `${TEST_PAYEE_PREFIX} ${new Date().toLocaleTimeString()}`;
  const row = await timed("Create through the data layer", () => store().create(model("Payee"), { name }), (r) => `id ${String(r.id)}`);
  note(`Payee "${String(row.name)}" is now in the cloud. On the desktop it should appear under Payees after the next sync.`);
}

async function renamePayee(): Promise<void> {
  line("── Rename (one autocommitted UPDATE … RETURNING) ──");
  const [first] = await testPayees();
  if (!first) {
    bad("There is no test payee to rename. Add one first.");
    return;
  }
  const name = `${TEST_PAYEE_PREFIX} renamed ${new Date().toLocaleTimeString()}`;
  await timed("Update through the data layer", () => store().update(model("Payee"), first.id, { name }), (r) => `now "${String(r.name)}"`);
}

async function removePayees(): Promise<void> {
  line("── Delete (interactive transaction: BEGIN, DELETE … RETURNING, COMMIT) ──");
  const found = await testPayees();
  if (found.length === 0) {
    note("No test payee in the cloud. Nothing to delete.");
    return;
  }
  for (const p of found) {
    await timed(`Remove "${p.name}"`, () => store().remove(model("Payee"), p.id));
  }
  const left = await testPayees();
  if (left.length === 0) ok("No test payee is left in the cloud.");
  else bad(`${left.length} test payee(s) are still there.`);
}

// ── Wiring ──

function wire(button: HTMLButtonElement, step: () => Promise<void>): void {
  button.addEventListener("click", async () => {
    Object.values(buttons).forEach((b) => (b.disabled = true));
    try {
      await step();
    } catch {
      /* already reported by `timed` */
    } finally {
      // The write buttons follow the gate: on only while a store exists,
      // which readChecks creates as its very last step.
      buttons.read.disabled = false;
      setWriteButtons(current?.store != null);
    }
  });
}

urlInput.addEventListener("input", showTarget);
wire(buttons.read, readChecks);
wire(buttons.add, addPayee);
wire(buttons.rename, renamePayee);
wire(buttons.remove, removePayees);
line("Ready. Enter the database, then run the read checks.", "dim");
