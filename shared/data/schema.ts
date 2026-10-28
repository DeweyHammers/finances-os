/**
 * schema.ts — what the data layer knows about every table.
 *
 * The SQL that CREATES the tables is generated from prisma/schema.prisma
 * (shared/data/schema.sql, see scripts/generate-schema-sql.ts). This file is
 * the hand-written, typed view of the same models that the CRUD code needs at
 * runtime: column names in declaration order, their Prisma scalar type (which
 * decides how a value is validated, stored and read back), nullability and
 * the two client-side defaults Prisma used to fill in (`cuid()` ids and
 * `now()` timestamps). schema.test.ts checks this file against schema.sql
 * column by column, so the two can't drift apart silently.
 *
 * Storage conventions (identical to what the Prisma client wrote, so an
 * existing dev.db / PROD database is read and written in place):
 *   String   → TEXT
 *   Int      → INTEGER
 *   Float    → REAL
 *   Boolean  → INTEGER 0 / 1
 *   DateTime → INTEGER Unix milliseconds (older rows may hold ISO text or a
 *              CURRENT_TIMESTAMP "YYYY-MM-DD HH:MM:SS" string; both are read)
 */

/**
 * Version of the database shape this build of the app understands. Bump it
 * with every schema change (together with a migration step in store.ts) and
 * regenerate schema.sql. Phase D of plans/phone-app-and-sync.md gates sync on
 * it: an app older than the database refuses to write.
 */
export const SCHEMA_VERSION = 1;

export type ScalarType = "String" | "Int" | "Float" | "Boolean" | "DateTime";

export interface Column {
  name: string;
  type: ScalarType;
  /** Column accepts NULL (Prisma `Type?`). */
  nullable: boolean;
  /**
   * Value the data layer generates when the caller omits the column:
   *   "cuid" — a 25-char id like Prisma's `@default(cuid())`
   *   "now"  — the current time, like `@default(now())`
   * Literal defaults (`@default(0)`, `@default("Q1")`, …) live in the DDL and
   * are applied by SQLite when the column is left out of the INSERT.
   */
  generated?: "cuid" | "now";
}

export interface Model {
  /** Prisma model name = table name = REST resource name (`/api/Bill`). */
  name: string;
  columns: Column[];
  /** Name of the primary-key column (always a single column here). */
  idColumn: string;
  /**
   * Not reachable through `/api/:resource`. The schema-version table is
   * bookkeeping for the data layer, not user data.
   */
  internal?: boolean;
}

/**
 * Mini-DSL so the table below stays readable: one string per column,
 * `"<name> <Type>[?] [cuid|now]"`. The first column is the id.
 */
function model(name: string, specs: string[], opts: { internal?: boolean } = {}): Model {
  const columns = specs.map((spec): Column => {
    const [colName, rawType, generated] = spec.split(/\s+/);
    const nullable = rawType.endsWith("?");
    const type = (nullable ? rawType.slice(0, -1) : rawType) as ScalarType;
    if (!["String", "Int", "Float", "Boolean", "DateTime"].includes(type)) {
      throw new Error(`schema.ts: bad column spec "${spec}" in ${name}`);
    }
    if (generated !== undefined && generated !== "cuid" && generated !== "now") {
      throw new Error(`schema.ts: bad generated kind "${generated}" in ${name}`);
    }
    return { name: colName, type, nullable, ...(generated ? { generated } : {}) };
  });
  return { name, columns, idColumn: columns[0].name, ...opts };
}

/** Every model, in prisma/schema.prisma order. */
export const MODELS: readonly Model[] = [
  model("Income", [
    "id String cuid",
    "name String",
    "amount Float",
    "paymentCycle String",
    "payDay Int",
    "payWeekOffset Int",
    "isPrimary Boolean",
  ]),
  // `id` defaults to 'global' in the DDL (no cuid): the single settings row.
  model("AppSettings", [
    "id String",
    "paymentCycle String",
    "payDay Int",
    "eddActive Boolean",
    "eddRemainingBalance Float",
    "baseEddWeeklyAmount Float",
    "w2Active Boolean",
    "w2Amount Float",
    "upworkActive Boolean",
    "upworkTaxProvisionPercent Float",
    "upworkExpensesHoldActive Boolean",
    "upworkExpensesHoldAmount Float",
    "upworkMinWithdrawalAmount Float",
    "wifeMonthlyAmount Float",
    "wifeWeeklyTargetCents Int",
    "optimizedInputsSig String?",
  ]),
  model("Earning", [
    "id String cuid",
    "amount Float",
    "date DateTime now",
    "description String?",
    "isWithdrawn Boolean",
  ]),
  model("Withdrawal", ["id String cuid", "amount Float", "date DateTime now", "description String?"]),
  model("DeductibleExpense", ["id String cuid", "amount Float", "date DateTime now", "description String?"]),
  model("EddPayment", ["id String cuid", "amount Float", "date DateTime now"]),
  model("Client", ["id String cuid", "name String"]),
  model("Contract", [
    "id String cuid",
    "name String",
    "status String",
    "type String",
    "grossRate Float",
    "netRate Float",
    "feePercent Float",
    "weeklyHours Int",
    "startDate DateTime now",
    "endDate DateTime?",
    "completedDate DateTime?",
    "clientId String",
  ]),
  model("ContractEntry", [
    "id String cuid",
    "date DateTime now",
    "grossPay Float",
    "netPay Float",
    "hours Float",
    "contractId String",
  ]),
  model("Bill", [
    "id String cuid",
    "name String",
    "amount Float",
    "dueDate Int",
    "withdrawalCycle String",
    "isAutoPay Boolean",
    "neverSplit Boolean",
  ]),
  model("BillSplit", [
    "id String cuid",
    "billId String",
    "monthKey String",
    "weekIndex Int",
    "amountCents Int",
    "occurrenceCoord Int",
  ]),
  model("Personal", [
    "id String cuid",
    "name String",
    "amount Float",
    "dueDate Int",
    "weekOfMonth Int?",
    "withdrawalCycle String",
    "repeatWeekly Boolean",
    "splitAcrossWeeks Boolean",
  ]),
  model("YearlyCost", ["id String cuid", "name String", "amount Float", "month Int", "day Int"]),
  model("JobReported", ["id String cuid", "employerName String", "date DateTime now"]),
  model("Account", ["id String cuid", "name String", "notes String?", "closed Boolean", "sortOrder Int"]),
  model("AccountTransaction", [
    "id String cuid",
    "accountId String",
    "date DateTime now",
    "payeeId String?",
    "categoryItemId String?",
    "categoryName String?",
    "memo String?",
    "inflowCents Int",
    "outflowCents Int",
    "isAdjustment Boolean",
    "cleared Boolean",
  ]),
  model("Payee", ["id String cuid", "name String"]),
  model("BudgetCategoryGroup", ["id String cuid", "name String", "sortOrder Int"]),
  model("BudgetCategorySubsection", ["id String cuid", "groupId String", "name String", "sortOrder Int"]),
  model("BudgetCategoryItem", [
    "id String cuid",
    "groupId String",
    "subsectionId String?",
    "name String",
    "sortOrder Int",
    "sourceType String",
    "sourceBillId String?",
    "sourcePersonalName String?",
    "customAmountCents Int?",
    "customCycle String?",
  ]),
  model("BudgetMonth", ["id String cuid", "month DateTime", "categoryItemId String", "assignedCents Int"]),
  model("SchemaVersion", ["version Int", "appliedAt DateTime now"], { internal: true }),
];

const BY_LOWER_NAME = new Map(MODELS.map((m) => [m.name.toLowerCase(), m]));

/**
 * The model behind a REST resource name, matched case-insensitively exactly
 * as the old `getModel()` did against the Prisma client's keys (`/api/Bill`,
 * `/api/bill` and `/api/BILL` all reach the Bill table). Internal tables and
 * unknown names give `undefined`, which the routes turn into a 404.
 */
export function resolveModel(resource: string): Model | undefined {
  const m = BY_LOWER_NAME.get(resource.toLowerCase());
  return m && !m.internal ? m : undefined;
}

/** Same lookup by exact model name, internal tables included. */
export function getModelByName(name: string): Model {
  const m = BY_LOWER_NAME.get(name.toLowerCase());
  if (!m) throw new Error(`Unknown model ${name}`);
  return m;
}
