import { PrismaClient } from "@prisma/client";
import { app } from "electron";
import path from "path";
import fs from "fs";

// Declare global at the top to avoid ReferenceError in bundled code
const globalForPrisma = global as unknown as { prisma: PrismaClient };

const isProd = process.env.NODE_ENV === "production" || (app && app.isPackaged);

// In dev mode, use the local prisma folder. In prod, use userData.
let dbUrl = "file:./prisma/dev.db";

// Logger helper
const logFile = app
  ? path.join(app.getPath("userData"), "prisma-setup.log")
  : null;
function prismaLog(msg: string) {
  console.log(`[PrismaSetup] ${msg}`);
  if (logFile && isProd) {
    try {
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
    } catch (e) {}
  }
}

if (isProd && app) {
  const userDataPath = app.getPath("userData");
  const dbPath = path.join(userDataPath, "database.db");

  const appPath = app.getAppPath();
  const actualResourcesPath = path.dirname(appPath);

  if (!fs.existsSync(dbPath)) {
    const templateDbPath = path.join(
      actualResourcesPath,
      "app.asar.unpacked/prisma/dev.db",
    );
    const templateDbPathInAsar = path.join(
      actualResourcesPath,
      "prisma/dev.db",
    );

    try {
      if (fs.existsSync(templateDbPath)) {
        fs.copyFileSync(templateDbPath, dbPath);
      } else if (fs.existsSync(templateDbPathInAsar)) {
        fs.copyFileSync(templateDbPathInAsar, dbPath);
      }
    } catch (e: any) {
      prismaLog(`Failed to copy database template: ${e.message}`);
    }
  }
  dbUrl = `file:${dbPath}`;

  // Handle Query Engine path
  const enginePath = path.join(
    actualResourcesPath,
    "prisma/query_engine-windows.dll.node",
  );
  const fallbackEnginePath = path.join(
    actualResourcesPath,
    "app.asar.unpacked/node_modules/.prisma/client/query_engine-windows.dll.node",
  );

  if (fs.existsSync(enginePath)) {
    process.env.PRISMA_QUERY_ENGINE_LIBRARY = enginePath;
  } else if (fs.existsSync(fallbackEnginePath)) {
    process.env.PRISMA_QUERY_ENGINE_LIBRARY = fallbackEnginePath;
  }
} else {
  // DEVELOPMENT MODE
  // Ensure the dev DB path is absolute to avoid confusion during dev
  dbUrl = `file:${path.join(process.cwd(), "prisma/dev.db")}`;
}

let prismaInstance: PrismaClient;

try {
  prismaInstance =
    globalForPrisma.prisma ||
    new PrismaClient({
      datasources: {
        db: {
          url: dbUrl,
        },
      },
    });
  if (isProd) prismaLog("PrismaClient initialized successfully");
} catch (e: any) {
  prismaLog(`CRITICAL: PrismaClient failed to initialize: ${e.message}`);
  throw e;
}

export const prisma = prismaInstance;

export function getModel(resource: string) {
  const modelName = resource.charAt(0).toLowerCase() + resource.slice(1);
  let model = (prisma as any)[modelName];

  if (!model) {
    const keys = Object.keys(prisma);
    const match = keys.find(
      (key) => key.toLowerCase() === resource.toLowerCase(),
    );
    if (match) model = (prisma as any)[match];
  }
  return model;
}

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
