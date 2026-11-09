/**
 * libsql-sync-server.ts — an in-process stand-in for the cloud side of
 * libsql's OFFLINE-WRITES sync protocol (the "synced database" mode that
 * `new Database(path, { syncUrl, authToken, offline: true })` uses, libsql
 * 0.9.30 → libsql/src/sync.rs). Only Turso Cloud serves this protocol — the
 * open-source libsql-server image does not — so the tests and the manual
 * checks talk to this instead. It mirrors libsql's own in-process test
 * server (libsql/src/sync/test.rs) and adds the rules a real server needs
 * for a second writer: frames are stored, pulled back in order, and a push
 * that doesn't continue the server's frame log is a conflict.
 *
 * The sync protocol (all paths relative to the sync URL):
 *   GET  /info                      → { current_generation }
 *   GET  /export/{gen}              → the database file at the start of that generation
 *   POST /sync/{gen}/{start}/{end}  → body = WAL frames [start, end); answers
 *                                     { status: "ok" | "conflict", generation, max_frame_no }
 *   GET  /sync/{gen}/{start}/{end}  → frames [start, end) as bytes, or 400 { generation }
 *                                     when there is nothing past `start` (end of generation)
 *
 * A frame is a 24-byte header (page number, commit size, salts, checksums —
 * the receiving side ignores salts and checksums and rewrites them) plus one
 * 4096-byte page. The server keeps the generation's base file plus the frame
 * log; `materialize()` applies the log to the base.
 *
 * It also speaks enough of Hrana over HTTP (`POST /v2/pipeline`, JSON) for
 * `@libsql/client`, which the app uses for the direct-to-cloud work (probe,
 * first upload, Keep, Import, conflict resolution): statements run on a
 * temporary plain copy of the current contents, and the WAL frames they
 * produce are appended to the log — so a replica pulls them exactly as it
 * would from Turso after a write through the HTTP API.
 *
 * Switches for the tests: `reachable = false` drops every connection (the
 * client sees a network error, which libsql folds into "0 frames synced"),
 * `hang = true` accepts requests and never answers (the black-hole case).
 *
 * The out-of-process variant is what the app code is tested against: libsql
 * bootstraps a synced database INSIDE the synchronous `new Database()`
 * (block_on on the JS thread), so a server on the same event loop could
 * never answer — `startSyncServerProcess` forks libsql-sync-server-child.ts
 * and drives it over IPC with the same API.
 */
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { fork, type ChildProcess } from "child_process";
import type { AddressInfo } from "net";
import Database from "libsql";
import { collectGarbage } from "../../shared/data/backends/libsql";
import type { Row, SqlValue, Statement } from "../../shared/data";

export const PAGE_SIZE = 4096;
const FRAME_HEADER = 24;
export const FRAME_SIZE = PAGE_SIZE + FRAME_HEADER;
const WAL_HEADER = 32;

export interface SyncServerRemote {
  exec(sql: string, params?: SqlValue[]): Promise<Row[]>;
  batch(statements: Statement[]): Promise<void>;
  close(): void;
}

export interface SyncServerSnapshot {
  generation: number;
  maxFrame: number;
  pushes: number;
  pulls: number;
  requests: string[];
  authHeaders: string[];
  reachable: boolean;
  hang: boolean;
}

/** A temporary plain copy of the cloud's contents that statements run on. */
interface OpenSession {
  db: Database.Database;
  file: string;
  /** Lets the next session start (see `openSession`). */
  release: () => void;
  /** Set while a Hrana stream holds it open between requests. */
  idle?: NodeJS.Timeout;
}

/**
 * How long a Hrana stream may sit open between two requests before the mock
 * rolls it back (Turso closes idle streams too). A stream holds the session
 * turn, so an abandoned one must not block the next write for long.
 */
const STREAM_IDLE_MS = 10_000;

export class LibsqlSyncServer {
  generation = 1;
  /** The database file at the start of the current generation. */
  base: Buffer;
  /** Frames 1..n of the current generation. */
  frames: Buffer[] = [];
  reachable = true;
  hang = false;
  /** Every request as "METHOD path", for assertions. */
  requests: string[] = [];
  pushes = 0;
  pulls = 0;
  /** Authorization headers seen (the token the clients sent). */
  authHeaders = new Set<string>();

  private server: http.Server | null = null;
  private pending: http.ServerResponse[] = [];
  private readonly tmp: string;
  private sessionChain: Promise<unknown> = Promise.resolve();
  url = "";

  private constructor(base: Buffer) {
    this.base = base;
    this.tmp = fs.mkdtempSync(path.join(os.tmpdir(), "libsql-sync-server-"));
  }

  /** Start on `port` (0 = a free one) on loopback. `base` is the initial database file (empty by default). */
  static async start(options: { base?: Buffer; port?: number } = {}): Promise<LibsqlSyncServer> {
    const s = new LibsqlSyncServer(options.base ?? emptyWalDatabase());
    s.server = http.createServer((req, res) => void s.handle(req, res));
    await new Promise<void>((resolve) => s.server!.listen(options.port ?? 0, "127.0.0.1", resolve));
    s.url = `http://127.0.0.1:${(s.server.address() as AddressInfo).port}`;
    return s;
  }

  /** Drop the requests held while `hang` was on (their clients see a network error). */
  releaseHung(): void {
    for (const res of this.pending.splice(0)) res.destroy();
  }

  /** Back to a brand-new empty cloud database (generation 1, no frames). */
  reset(): void {
    this.base = emptyWalDatabase();
    this.frames = [];
    this.generation = 1;
    this.requests = [];
    this.pushes = 0;
    this.pulls = 0;
    this.authHeaders.clear();
    this.storedSql.clear();
    this.reachable = true;
    this.hang = false;
    this.releaseHung();
    // Streams left open belong to the old contents: roll them back. Not
    // awaited (reset is synchronous for its callers); the next session waits
    // for its turn behind them anyway.
    void this.dropStreams();
  }

  async close(): Promise<void> {
    this.releaseHung();
    await this.dropStreams();
    if (this.server) {
      this.server.closeAllConnections?.();
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
    fs.rmSync(this.tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  get maxFrame(): number {
    return this.frames.length;
  }

  snapshot(): SyncServerSnapshot {
    return {
      generation: this.generation,
      maxFrame: this.maxFrame,
      pushes: this.pushes,
      pulls: this.pulls,
      requests: [...this.requests],
      authHeaders: Array.from(this.authHeaders),
      reachable: this.reachable,
      hang: this.hang,
    };
  }

  /** The current contents as one plain SQLite file (base + frames applied). */
  materialize(): Buffer {
    let out = Buffer.from(this.base);
    let commitPages = 0;
    for (const frame of this.frames) {
      const pgno = frame.readUInt32BE(0);
      const sizeAfter = frame.readUInt32BE(4);
      const need = pgno * PAGE_SIZE;
      if (out.length < need) out = Buffer.concat([out, Buffer.alloc(need - out.length)]);
      frame.copy(out, (pgno - 1) * PAGE_SIZE, FRAME_HEADER, FRAME_SIZE);
      if (sizeAfter > 0) commitPages = sizeAfter;
    }
    if (commitPages > 0 && out.length > commitPages * PAGE_SIZE) out = out.subarray(0, commitPages * PAGE_SIZE);
    return out;
  }

  /** The server checkpointed: the frames become the next generation's base. */
  newGeneration(): void {
    this.base = this.materialize();
    this.frames = [];
    this.generation += 1;
  }

  /**
   * Run `fn` against a temporary plain copy of the current contents, then
   * append the WAL frames it committed to the log. Sessions are serialised:
   * two at once would both start from the same frames.
   */
  private async session<T>(fn: (db: Database.Database) => T): Promise<T> {
    const s = await this.openSession();
    let ok = false;
    try {
      const result = fn(s.db);
      ok = true;
      return result;
    } finally {
      await this.closeSession(s, ok);
    }
  }

  /**
   * Open a temporary plain copy of the current contents, once every earlier
   * session has finished (its turn in `sessionChain`). The caller MUST hand
   * it to `closeSession`, which is what lets the next session start. Split
   * out of `session()` on Nov 9 2026 so a Hrana stream the client keeps open
   * across several HTTP requests (an interactive transaction — what the
   * phone app's data layer uses for BEGIN … COMMIT) can hold one.
   */
  private async openSession(): Promise<OpenSession> {
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    const before = this.sessionChain;
    this.sessionChain = before.then(() => mine);
    await before;
    const file = path.join(this.tmp, `session-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    let db: Database.Database | null = null;
    try {
      fs.writeFileSync(file, this.materialize());
      db = new Database(file);
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA wal_autocheckpoint = 0");
      db.exec("PRAGMA foreign_keys = ON");
      return { db, file, release };
    } catch (e) {
      db?.close();
      release();
      throw e;
    }
  }

  /**
   * Close a session. With `harvest`, the WAL frames it COMMITTED are appended
   * to the log first (a transaction left open is rolled back: its frames sit
   * after the last commit frame and `harvestFrames` drops them).
   */
  private async closeSession(s: OpenSession, harvest: boolean): Promise<void> {
    if (s.idle) clearTimeout(s.idle);
    try {
      if (s.db.inTransaction) s.db.exec("ROLLBACK");
      // Before close(): closing the last connection checkpoints the WAL away.
      if (harvest) this.frames.push(...harvestFrames(`${s.file}-wal`));
    } finally {
      // libsql frees its statements only when GC collects them, and the
      // file stays open until then (see backends/libsql.ts → close); the
      // temp files are swept at close() anyway, so a failed delete is fine.
      collectGarbage();
      await new Promise((r) => setImmediate(r));
      s.db.close();
      collectGarbage();
      await new Promise((r) => setImmediate(r));
      for (const f of [s.file, `${s.file}-wal`, `${s.file}-shm`]) {
        try {
          fs.rmSync(f, { force: true });
        } catch {
          /* swept at close() */
        }
      }
      s.release();
    }
  }

  /** Roll back and close every stream a client left open (reset / close). */
  private async dropStreams(): Promise<void> {
    const open = Array.from(this.streams.values());
    this.streams.clear();
    for (const s of open) await this.closeSession(s, false);
  }

  /** Run statements "in the cloud" inside one transaction and record the frames they produce. */
  batch(statements: Statement[]): Promise<Row[][]> {
    return this.session((db) => {
      db.prepare("BEGIN").all();
      try {
        const results = statements.map((s) => db.prepare(s.sql).all(...(s.args as any[])) as Row[]);
        db.prepare("COMMIT").all();
        return results;
      } catch (e) {
        db.prepare("ROLLBACK").all();
        throw e;
      }
    });
  }

  async exec(sql: string, params: SqlValue[] = []): Promise<Row[]> {
    return (await this.batch([{ sql, args: params }]))[0];
  }

  /** The app's `RemoteDatabase` shape (main/sync.ts transport), without HTTP. */
  remote(): SyncServerRemote {
    return {
      exec: (sql, params) => this.exec(sql, params),
      batch: async (statements) => {
        await this.batch(statements);
      },
      close: () => {},
    };
  }

  // ── HTTP ──

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Control endpoints for the standalone (browser-check) server; they
    // answer even while the "cloud" is playing unreachable.
    //   POST /_mock/reachable/{on|off}   POST /_mock/hang/{on|off}
    //   POST /_mock/exec  (body: SQL)    = a write by another device
    //   GET  /_mock/snapshot
    if (req.url?.startsWith("/_mock/")) {
      await this.control(req, res);
      return;
    }
    if (!this.reachable) {
      req.socket.destroy();
      return;
    }
    if (this.hang) {
      this.pending.push(res);
      return;
    }
    // CORS, for a browser page on another origin (the phone app's dev check
    // talks to this mock straight from the page, as it will to Turso from the
    // app's WebView). The app's own clients run in Node and never send a
    // preflight, so this changes nothing for them — and an OPTIONS request is
    // not recorded in `requests`, which the tests assert on.
    res.setHeader("access-control-allow-origin", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "authorization, content-type",
        "access-control-max-age": "600",
      });
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", this.url);
    this.requests.push(`${req.method} ${url.pathname}`);
    if (req.headers.authorization) this.authHeaders.add(req.headers.authorization);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/info") {
      json(200, { current_generation: this.generation });
      return;
    }
    if (req.method === "GET" && parts[0] === "export") {
      const gen = Number(parts[1]);
      if (gen !== this.generation) {
        json(400, { error: `generation ${gen} is not current (${this.generation})` });
        return;
      }
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(this.base);
      return;
    }
    if (parts[0] === "sync" && parts.length >= 4) {
      const gen = Number(parts[1]);
      const start = Number(parts[2]);
      const end = Number(parts[3]);
      if (req.method === "POST") {
        this.pushes += 1;
        const body = await readBody(req);
        if (gen !== this.generation) {
          json(200, { status: "conflict", generation: this.generation, max_frame_no: this.maxFrame });
          return;
        }
        if (body.length !== (end - start) * FRAME_SIZE || body.length === 0) {
          json(400, { error: `expected ${(end - start) * FRAME_SIZE} bytes, got ${body.length}` });
          return;
        }
        for (let i = 0; i < end - start; i++) {
          const no = start + i;
          const frame = body.subarray(i * FRAME_SIZE, (i + 1) * FRAME_SIZE);
          if (no <= this.maxFrame) {
            // A re-push of a frame the server already holds (the client
            // crashed before recording the push) is fine when the page is
            // the same; a different page at a taken index is another
            // device's write → conflict.
            const have = this.frames[no - 1];
            if (!have.subarray(FRAME_HEADER).equals(frame.subarray(FRAME_HEADER))) {
              json(200, { status: "conflict", generation: this.generation, max_frame_no: this.maxFrame });
              return;
            }
            continue;
          }
          if (no !== this.maxFrame + 1) {
            json(200, { status: "conflict", generation: this.generation, max_frame_no: this.maxFrame });
            return;
          }
          this.frames.push(Buffer.from(frame));
        }
        json(200, { status: "ok", generation: this.generation, max_frame_no: this.maxFrame });
        return;
      }
      if (req.method === "GET") {
        this.pulls += 1;
        if (gen !== this.generation || start > this.maxFrame) {
          // End of this generation: the client checkpoints and moves on
          // when `generation` is higher, or stops when it is the same.
          json(400, { generation: this.generation });
          return;
        }
        const last = Math.min(end - 1, this.maxFrame);
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(Buffer.concat(this.frames.slice(start - 1, last)));
        return;
      }
    }

    // ── Hrana over HTTP (what @libsql/client speaks) ──
    if (req.method === "GET" && (url.pathname === "/v3-protobuf" || url.pathname === "/v3")) {
      // Not offered: the client then falls back to JSON v2.
      json(404, { error: "not supported" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v2/pipeline") {
      try {
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        json(200, await this.pipeline(body));
      } catch (e: any) {
        json(500, { error: e?.message ?? String(e) });
      }
      return;
    }
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200);
      res.end("ok");
      return;
    }
    json(404, { error: "not found" });
  }

  private async control(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const parts = (req.url ?? "").split("/").filter(Boolean); // ["_mock", ...]
    try {
      if (req.method === "GET" && parts[1] === "snapshot") return json(200, this.snapshot());
      if (req.method === "POST" && (parts[1] === "reachable" || parts[1] === "hang")) {
        const on = parts[2] === "on";
        this[parts[1]] = on;
        if (parts[1] === "hang" && !on) this.releaseHung();
        return json(200, { [parts[1]]: on });
      }
      if (req.method === "POST" && parts[1] === "exec") {
        const sql = (await readBody(req)).toString("utf8");
        return json(200, { rows: await this.exec(sql), maxFrame: this.maxFrame });
      }
      json(404, { error: "unknown control request" });
    } catch (e: any) {
      json(500, { error: e?.message ?? String(e) });
    }
  }

  /** SQL texts stored by id (`store_sql`), which @libsql/client uses for batches. */
  private readonly storedSql = new Map<number, string>();

  /** Hrana streams a client left open: the baton it must send next → the session it holds. */
  private readonly streams = new Map<string, OpenSession>();

  /**
   * One Hrana v2 pipeline: every request runs in order on one stream.
   *
   * A stream is one session. A client that ends its pipeline with `close`
   * (every plain `execute` / `batch` of @libsql/client does) gets the old
   * behaviour: one request, one session, `baton: null`. A client that does
   * NOT close — `client.transaction()`, an interactive transaction spread
   * over several HTTP requests — gets a baton back and the session stays
   * open for the request that presents it (Nov 9 2026, for the phone app:
   * its data layer's BEGIN … COMMIT runs this way over HTTP). Frames reach
   * the log when the stream closes; an idle or abandoned stream is rolled
   * back after STREAM_IDLE_MS. While a stream is open no other session
   * starts (one writer at a time, like SQLite). Not modelled: a frame PUSH
   * arriving while a stream is open — the two would both extend the same
   * log; the tests never do that.
   */
  private async pipeline(body: { baton?: string | null; requests: any[] }): Promise<unknown> {
    let s: OpenSession;
    if (body.baton) {
      const open = this.streams.get(body.baton);
      if (!open) throw new Error("stream not found: the baton is unknown, already used, or the stream was closed for being idle");
      this.streams.delete(body.baton);
      if (open.idle) clearTimeout(open.idle);
      open.idle = undefined;
      s = open;
    } else {
      s = await this.openSession();
    }
    const db = s.db;
    let closeAsked = false;
    let response: { results: unknown[] };
    try {
      response = this.runPipeline(db, body.requests, () => (closeAsked = true));
    } catch (e) {
      await this.closeSession(s, false);
      throw e;
    }
    if (closeAsked) {
      await this.closeSession(s, true);
      return { baton: null, base_url: null, results: response.results };
    }
    const baton = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    s.idle = setTimeout(() => {
      if (this.streams.delete(baton)) void this.closeSession(s, false);
    }, STREAM_IDLE_MS);
    s.idle.unref?.();
    this.streams.set(baton, s);
    return { baton, base_url: null, results: response.results };
  }

  private runPipeline(db: Database.Database, requests: any[], onClose: () => void): { results: unknown[] } {
    {
      const sqlOf = (stmt: any): string => {
        if (typeof stmt.sql === "string") return stmt.sql;
        const stored = this.storedSql.get(stmt.sql_id);
        if (stored === undefined) throw new Error(`unknown sql_id ${stmt.sql_id}`);
        return stored;
      };
      const results = requests.map((request) => {
        try {
          if (request.type === "close") {
            onClose();
            return { type: "ok", response: { type: "close" } };
          }
          if (request.type === "store_sql") {
            this.storedSql.set(request.sql_id, request.sql);
            return { type: "ok", response: { type: "store_sql" } };
          }
          if (request.type === "close_sql") {
            this.storedSql.delete(request.sql_id);
            return { type: "ok", response: { type: "close_sql" } };
          }
          if (request.type === "execute") {
            return { type: "ok", response: { type: "execute", result: runHranaStmt(db, sqlOf(request.stmt), request.stmt) } };
          }
          if (request.type === "batch") {
            const stepResults: unknown[] = [];
            const stepErrors: unknown[] = [];
            const okAt = (i: number) => stepResults[i] !== null && stepResults[i] !== undefined;
            const evaluate = (cond: any): boolean => {
              switch (cond.type) {
                case "ok":
                  return okAt(cond.step);
                case "error":
                  return stepErrors[cond.step] != null;
                case "not":
                  return !evaluate(cond.cond);
                case "and":
                  return cond.conds.every(evaluate);
                case "or":
                  return cond.conds.some(evaluate);
                case "is_autocommit":
                  return !db.inTransaction;
                default:
                  throw new Error(`unknown batch condition ${cond.type}`);
              }
            };
            for (const step of request.batch.steps as any[]) {
              if (step.condition && !evaluate(step.condition)) {
                stepResults.push(null);
                stepErrors.push(null);
                continue;
              }
              try {
                stepResults.push(runHranaStmt(db, sqlOf(step.stmt), step.stmt));
                stepErrors.push(null);
              } catch (e: any) {
                stepResults.push(null);
                stepErrors.push({ message: e?.message ?? String(e) });
              }
            }
            return { type: "ok", response: { type: "batch", result: { step_results: stepResults, step_errors: stepErrors } } };
          }
          throw new Error(`unsupported hrana request ${request.type}`);
        } catch (e: any) {
          return { type: "error", error: { message: e?.message ?? String(e) } };
        }
      });
      return { results };
    }
  }
}

/** Run one Hrana statement on a plain libsql connection and encode its result. */
function runHranaStmt(db: Database.Database, sql: string, stmt: any): unknown {
  const args = ((stmt.args ?? []) as any[]).map(decodeHranaValue);
  if (stmt.named_args?.length) throw new Error("named arguments are not supported by the mock");
  const prepared = db.prepare(sql);
  const columns = prepared.columns() as { name: string; type: string | null }[];
  if (prepared.reader) {
    const rows = prepared.raw(true).all(...args) as unknown[][];
    return {
      cols: columns.map((c) => ({ name: c.name, decltype: c.type ?? null })),
      rows: stmt.want_rows === false ? [] : rows.map((row) => row.map((v, i) => encodeHranaValue(v, columns[i]?.type))),
      affected_row_count: 0,
      last_insert_rowid: null,
    };
  }
  const info = prepared.run(...args) as { changes: number; lastInsertRowid: number | bigint };
  return {
    cols: [],
    rows: [],
    affected_row_count: Number(info.changes ?? 0),
    last_insert_rowid: info.lastInsertRowid != null ? String(info.lastInsertRowid) : null,
  };
}

function decodeHranaValue(v: any): unknown {
  switch (v?.type) {
    case "null":
      return null;
    case "integer":
      return BigInt(v.value);
    case "float":
      return Number(v.value);
    case "text":
      return String(v.value);
    case "blob":
      return Buffer.from(v.base64, "base64");
    default:
      throw new Error(`unknown hrana value type ${v?.type}`);
  }
}

function encodeHranaValue(v: unknown, decltype?: string | null): unknown {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "bigint") return { type: "integer", value: String(v) };
  if (typeof v === "number") {
    const real = /REAL|FLOA|DOUB/i.test(decltype ?? "");
    return Number.isInteger(v) && !real ? { type: "integer", value: String(v) } : { type: "float", value: v };
  }
  if (typeof v === "string") return { type: "text", value: v };
  if (v instanceof Uint8Array) return { type: "blob", base64: Buffer.from(v).toString("base64") };
  return { type: "text", value: String(v) };
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** A brand-new empty database file in WAL mode (what a new cloud database looks like). */
export function emptyWalDatabase(): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "libsql-sync-base-"));
  const file = path.join(dir, "base.db");
  const db = new Database(file);
  try {
    db.exec("PRAGMA journal_mode = WAL");
    // A table that is created and dropped again leaves a real page 1 behind,
    // so the file is a complete (if empty) database rather than 0 bytes.
    db.exec("CREATE TABLE __bootstrap (x)");
    db.exec("DROP TABLE __bootstrap");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
  const bytes = fs.readFileSync(file);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  return bytes;
}

/**
 * The committed frames of a WAL file, in order. A frame counts when its
 * salts match the header's (SQLite's validity rule); frames after the last
 * commit frame belong to an unfinished transaction and are dropped.
 */
export function harvestFrames(walPath: string): Buffer[] {
  if (!fs.existsSync(walPath)) return [];
  const wal = fs.readFileSync(walPath);
  if (wal.length < WAL_HEADER) return [];
  const pageSize = wal.readUInt32BE(8);
  if (pageSize !== PAGE_SIZE) throw new Error(`WAL page size ${pageSize} is not ${PAGE_SIZE}`);
  const salt1 = wal.readUInt32BE(16);
  const salt2 = wal.readUInt32BE(20);
  const frames: Buffer[] = [];
  let lastCommit = 0;
  for (let off = WAL_HEADER; off + FRAME_SIZE <= wal.length; off += FRAME_SIZE) {
    const frame = wal.subarray(off, off + FRAME_SIZE);
    if (frame.readUInt32BE(8) !== salt1 || frame.readUInt32BE(12) !== salt2) break;
    frames.push(Buffer.from(frame));
    if (frame.readUInt32BE(4) > 0) lastCommit = frames.length;
  }
  return frames.slice(0, lastCommit);
}

// ── Out-of-process server (the one the app code is tested against) ─────────

export class SyncServerProcess {
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  url = "";

  private constructor(private readonly child: ChildProcess) {
    child.on("message", (msg: any) => {
      const w = this.waiting.get(msg.id);
      if (!w) return;
      this.waiting.delete(msg.id);
      if (msg.error) w.reject(new Error(msg.error));
      else w.resolve(msg.result);
    });
    child.on("exit", (code, signal) => {
      // Say HOW it went (a native crash has no JS error to print: on Windows
      // an access violation is exit code 3221225477 = 0xC0000005), and
      // remember it: every later call must fail at once. Without this a
      // crashed child left each remaining test's hooks waiting out their
      // full timeout on a message that could never come — the run looked
      // hung for minutes (seen Nov 9 2026: the child died mid-pipeline about
      // once in eight runs of sync.routes.test.ts, old and new mock alike).
      this.exited = `sync server process exited (code ${code ?? "none"}, signal ${signal ?? "none"})`;
      for (const w of Array.from(this.waiting.values())) w.reject(new Error(this.exited));
      this.waiting.clear();
    });
  }

  /** Why the child is gone, once it is (see the exit handler). */
  private exited: string | null = null;

  static async start(options: { base?: Buffer; port?: number } = {}): Promise<SyncServerProcess> {
    const entry = path.join(__dirname, "libsql-sync-server-child.ts");
    const child = fork(entry, [], {
      // tsx compiles the TypeScript entry in the child; vitest's own loader
      // does not reach into forked processes.
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const s = new SyncServerProcess(child);
    s.url = (await s.call("start", [{ base: options.base?.toString("base64"), port: options.port }])) as string;
    return s;
  }

  private call(op: string, args: unknown[] = []): Promise<unknown> {
    if (this.exited) return Promise.reject(new Error(this.exited));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.child.send({ id, op, args }, (error) => {
        // The channel closed between the check above and the send.
        if (!error || !this.waiting.delete(id)) return;
        reject(new Error(this.exited ?? `sync server process is gone: ${error.message}`));
      });
    });
  }

  exec(sql: string, params: SqlValue[] = []): Promise<Row[]> {
    return this.call("exec", [sql, params]) as Promise<Row[]>;
  }

  async batch(statements: Statement[]): Promise<void> {
    await this.call("batch", [statements]);
  }

  remote(): SyncServerRemote {
    return { exec: (sql, params) => this.exec(sql, params), batch: (s) => this.batch(s), close: () => {} };
  }

  /** `reachable` / `hang` switches (turning `hang` off drops the held requests). */
  set(key: "reachable" | "hang", value: boolean): Promise<void> {
    return this.call("set", [key, value]) as Promise<void>;
  }

  /** Back to a brand-new empty cloud database. */
  reset(): Promise<void> {
    return this.call("reset") as Promise<void>;
  }

  snapshot(): Promise<SyncServerSnapshot> {
    return this.call("snapshot") as Promise<SyncServerSnapshot>;
  }

  clearRequests(): Promise<void> {
    return this.call("clearRequests") as Promise<void>;
  }

  async materialize(): Promise<Buffer> {
    return Buffer.from((await this.call("materialize")) as string, "base64");
  }

  newGeneration(): Promise<void> {
    return this.call("newGeneration") as Promise<void>;
  }

  async close(): Promise<void> {
    try {
      // The child may exit before its answer arrives; either way it is gone.
      await this.call("close").catch(() => {});
    } finally {
      this.child.kill();
    }
  }
}

export const startSyncServerProcess = SyncServerProcess.start;
