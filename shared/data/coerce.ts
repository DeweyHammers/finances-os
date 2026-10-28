/**
 * coerce.ts — turning request bodies into column values and rows back into
 * records.
 *
 *  - transformBody(): the API's historic body normalisation (trim strings,
 *    parse date strings, coerce the known numeric fields). Moved here from
 *    main/api-server.ts unchanged, so the phone applies the same rules.
 *  - toStorage() / fromStorage(): per-column-type conversion between JS
 *    values and what SQLite stores (see schema.ts → storage conventions),
 *    validated the way the Prisma client validated input: a wrong type is an
 *    error, never a silent cast.
 */
import type { Column, ScalarType } from "./schema";
import type { SqlValue } from "./sql";
import { DataError } from "./errors";

/** Body keys that are numeric fields in some model: "12.50" → 12.5 on the way in. */
const NUMERIC_KEYS = new Set([
  "amount",
  "dueDate",
  "grossPay",
  "netPay",
  "hours",
  "weeklyHours",
  "month",
  "day",
  "inflowCents",
  "outflowCents",
  "customAmountCents",
  "assignedCents",
  "sortOrder",
  "payDay",
  "payWeekOffset",
  "weekOfMonth",
]);

/**
 * Normalise a JSON body the way the API always has. Idempotent: running it
 * twice gives the same result, so the routes and the data layer can both
 * call it.
 */
export function transformBody(body: any) {
  const transformed = { ...body };
  Object.keys(transformed).forEach((key) => {
    const value = transformed[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        transformed[key] = new Date(`${trimmed}T00:00:00Z`);
      } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
        transformed[key] = new Date(`${trimmed}:00Z`);
      } else if (
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(trimmed)
      ) {
        transformed[key] = new Date(trimmed);
      } else if (
        (trimmed !== "" &&
          !isNaN(Number(trimmed)) &&
          !trimmed.startsWith("0")) ||
        trimmed === "0"
      ) {
        // Only convert to number if it's a valid number and doesn't have leading zeros (unless it's just "0")
        // This avoids converting IDs that might be numeric strings
        if (NUMERIC_KEYS.has(key)) {
          const num = Number(trimmed);
          if (!isNaN(num)) {
            transformed[key] = num;
          }
        } else {
          transformed[key] = trimmed;
        }
      } else {
        transformed[key] = trimmed;
      }
    }
  });
  return transformed;
}

function expected(column: Column, value: unknown): DataError {
  const got = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  return new DataError(
    "VALIDATION",
    `Argument \`${column.name}\`: Invalid value provided. Expected ${column.type}${column.nullable ? " or null" : ""}, provided ${got}.`,
  );
}

/**
 * Parse a DateTime input the way Prisma accepted it: a Date, or an ISO-8601
 * string. Anything else is a validation error.
 */
export function parseDateTimeInput(column: Column, value: unknown): Date {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) throw expected(column, value);
    return value;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  throw expected(column, value);
}

/**
 * JS value → stored value for one column, with Prisma-strict validation
 * (an Int must be an integer number, a String must be a string, …).
 */
export function toStorage(column: Column, value: unknown): SqlValue {
  if (value === null) {
    if (!column.nullable) throw expected(column, value);
    return null;
  }
  switch (column.type) {
    case "String":
      if (typeof value !== "string") throw expected(column, value);
      return value;
    case "Int":
      if (typeof value !== "number" || !Number.isInteger(value)) throw expected(column, value);
      return value;
    case "Float":
      if (typeof value !== "number" || !Number.isFinite(value)) throw expected(column, value);
      return value;
    case "Boolean":
      if (typeof value !== "boolean") throw expected(column, value);
      return value ? 1 : 0;
    case "DateTime":
      return parseDateTimeInput(column, value).getTime();
  }
}

/**
 * Stored value → JS value. Lenient on purpose: it must read everything the
 * Prisma client ever wrote (integer ms, ISO text with "+00:00", and SQLite's
 * own CURRENT_TIMESTAMP text for rows that relied on the column default).
 */
export function fromStorage(type: ScalarType, value: SqlValue | undefined): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "String":
      return typeof value === "string" ? value : String(value);
    case "Int":
    case "Float":
      return typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : Number(value);
    case "Boolean":
      return typeof value === "string" ? value === "true" || value === "1" : Number(value) !== 0;
    case "DateTime":
      return readDateTime(value);
  }
}

function readDateTime(value: SqlValue): Date {
  if (typeof value === "number") return new Date(value);
  if (typeof value === "bigint") return new Date(Number(value));
  if (typeof value === "string") {
    // "YYYY-MM-DD HH:MM:SS[.fff]" is what DEFAULT CURRENT_TIMESTAMP writes; it
    // is UTC without saying so, so pin it before parsing.
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(value);
    const d = new Date(m ? `${m[1]}T${m[2]}Z` : value);
    if (!isNaN(d.getTime())) return d;
  }
  throw new DataError("CORRUPT", `Cannot read DateTime value ${String(value)}`);
}
