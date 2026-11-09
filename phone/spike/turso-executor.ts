/**
 * turso-executor.ts — SPIKE (plans/phone-app.md, step 1). The phone's whole
 * database backend: the shared data layer's `SqlConnection` on top of the
 * BROWSER build of @libsql/client, which speaks Hrana over HTTPS straight to
 * the user's Turso database. No local file, no sync engine.
 *
 * It is the candidate for `phone/src/data/turso-executor.ts` in piece 3; the
 * spike exists to prove this shape works from a browser before anything is
 * built on it.
 *
 * The one thing it has to translate: the data layer runs its multi-statement
 * rules as `exec("BEGIN")` … `exec("COMMIT")` (store.ts → transaction). Over
 * stateless HTTP a bare BEGIN would be forgotten by the next request, so
 * those three verbs are mapped onto ONE Hrana interactive transaction
 * (`client.transaction("write")`, kept alive across requests by the server's
 * baton); statements in between run on it, everything else is a single
 * autocommitted request. The store serialises its calls behind one lock, so
 * there is never more than one transaction open here.
 */
import { createClient, type Client, type InValue, type ResultSet, type Transaction } from "@libsql/client/web";
import type { Row, SqlConnection, SqlValue } from "../../shared/data";

export interface TursoConnection extends SqlConnection {
  /** The raw client, for the screen-level batched reads (`client.batch`). */
  readonly client: Client;
}

/** Rows as `{ column: value }`, the shape the data layer reads. */
function rowsOf(result: ResultSet): Row[] {
  return result.rows.map((row) => {
    const out: Row = {};
    result.columns.forEach((column, i) => {
      const v = row[i];
      // A BLOB arrives as an ArrayBuffer; the data layer knows Uint8Array.
      out[column] = v instanceof ArrayBuffer ? new Uint8Array(v) : (v as SqlValue);
    });
    return out;
  });
}

/**
 * Open the cloud database. `url` is what the user pastes into Settings
 * (`libsql://…turso.io`, which the client turns into https) or the sync
 * mock's `http://127.0.0.1:<port>`. Nothing is sent until the first `exec`.
 */
export function openTurso(url: string, authToken: string): TursoConnection {
  const client = createClient({ url, authToken });
  let tx: Transaction | null = null;

  return {
    client,

    async exec(sql: string, params: SqlValue[] = []): Promise<Row[]> {
      const verb = sql.trim().toUpperCase();
      if (verb === "BEGIN") {
        if (tx) throw new Error("A transaction is already open on this connection.");
        tx = await client.transaction("write");
        return [];
      }
      if (verb === "COMMIT") {
        const open = tx;
        tx = null;
        if (!open) throw new Error("COMMIT without a transaction.");
        await open.commit();
        return [];
      }
      if (verb === "ROLLBACK") {
        const open = tx;
        tx = null;
        if (open) await open.rollback();
        return [];
      }
      const statement = { sql, args: params as InValue[] };
      return rowsOf(await (tx ?? client).execute(statement));
    },

    async close(): Promise<void> {
      tx?.close();
      tx = null;
      client.close();
    },
  };
}
