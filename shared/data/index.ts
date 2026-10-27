/**
 * shared/data — the one data layer every Finances OS app uses (desktop now,
 * phone in Phase C of plans/phone-app-and-sync.md). See store.ts for what it
 * does and sql.ts for the tiny interface a backend has to provide.
 */
export { DataStore, createDatabase, ensureSchemaVersion, getSchemaVersion, prepareDatabase, RESOURCE_MODELS } from "./store";
export type { ListQuery, ListResult, Record_ } from "./store";
export { MODELS, SCHEMA_VERSION, resolveModel, getModelByName } from "./schema";
export type { Column, Model, ScalarType } from "./schema";
export { SCHEMA_SQL } from "./schema-sql";
export { splitStatements, quoteIdent } from "./sql";
export type { Row, SqlConnection, SqlExecutor, SqlValue } from "./sql";
export { transformBody, toStorage, fromStorage } from "./coerce";
export { DataError } from "./errors";
export {
  copyDatabase,
  countDataRows,
  dumpDatabase,
  hasNoTables,
  loadDatabase,
  loadStatements,
  schemaStatementsIfNotExists,
  schemaVersionGate,
  tablesInFkOrder,
} from "./transfer";
export type { DatabaseDump, Statement, TableDump } from "./transfer";
export type { DataErrorCode } from "./errors";
export { cuid } from "./cuid";
