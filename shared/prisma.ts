/**
 * prisma.ts — kept as the historical import path. The database connection
 * lives in shared/db.ts (a libsql-backed DataStore since Oct 2026, no
 * PrismaClient at runtime); everything here is a re-export.
 */
export {
  databaseUrlToPath,
  getCurrentDatabaseUrl,
  getRealDatabaseUrl,
  getStore,
  prisma,
  switchDatabase,
} from "./db";
