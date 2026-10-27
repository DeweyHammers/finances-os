/**
 * sql.ts — the whole contract between the data layer and a database engine.
 *
 * A backend only has to run one parameterised SQL statement and hand back the
 * rows. That is small enough for every target in plans/phone-app-and-sync.md:
 * libsql on the desktop (backends/libsql.ts), the Capacitor SQLite plugin on
 * the phone, and @libsql/client over HTTPS for a synced database. Everything
 * else — defaults, type conversion, filters, transactions, the business rules —
 * lives above this interface in store.ts and is therefore identical on every
 * device.
 */

/** A value SQLite can bind or return. Dates and booleans never cross this line. */
export type SqlValue = string | number | bigint | null | Uint8Array;

export type Row = Record<string, SqlValue>;

export interface SqlExecutor {
  /**
   * Run ONE statement with positional `?` parameters. Statements that return
   * data resolve to their rows; others resolve to `[]`. Errors (constraint
   * violations, bad SQL) reject.
   */
  exec(sql: string, params?: SqlValue[]): Promise<Row[]>;
}

/** A connection that can also be closed (needed to swap database files). */
export interface SqlConnection extends SqlExecutor {
  close(): Promise<void>;
}

/**
 * Split a multi-statement script (schema.sql) into single statements for
 * `exec`. Comment lines are dropped; a `;` at the end of a line ends a
 * statement. The generated DDL never has a `;` inside a string literal, so
 * this is enough — it is not a general SQL parser.
 */
export function splitStatements(script: string): string[] {
  const statements: string[] = [];
  let current: string[] = [];
  for (const rawLine of script.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim().startsWith("--") || line.trim() === "") continue;
    current.push(line);
    if (line.endsWith(";")) {
      statements.push(current.join("\n"));
      current = [];
    }
  }
  if (current.length) statements.push(current.join("\n"));
  return statements;
}

/** Quote an identifier for SQLite (`"name"`). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
