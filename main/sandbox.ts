/**
 * Sandbox mode — try changes against a COPY of the database, then throw the
 * copy away or keep it.
 *
 *   enter   copy real → sandbox.db, point the API at the copy
 *   discard point the API back at the real file, delete the copy
 *   keep    back up the real file, overwrite it with the copy, point the API
 *           back at it, delete the copy
 *
 * The sandbox file lives next to the real database (prisma/sandbox.db in dev,
 * %APPDATA%\finances-os\sandbox.db in PROD). A sandbox never outlives the
 * process: a copy left behind by a crash is deleted on the next startup
 * (`cleanupStaleSandbox`), so the app always opens on the real data. Every
 * route reaches the current file through the `prisma` Proxy in
 * shared/prisma.ts; this module only decides which file that is.
 */
import fs from "fs";
import path from "path";
import {
  databaseUrlToPath,
  getClient,
  getRealDatabaseUrl,
  switchDatabase,
} from "../shared/prisma";

export const SANDBOX_FILENAME = "sandbox.db";

export interface SandboxStatus {
  active: boolean;
  /** ISO timestamp of `enter`, null when inactive. */
  enteredAt: string | null;
  /** AccountTransaction rows added since `enter` — what Discard would lose. */
  transactionsAdded: number;
}

let enteredAt: string | null = null;
let baselineTxnCount = 0;

function realDbPath(): string {
  return databaseUrlToPath(getRealDatabaseUrl());
}

/** Where the sandbox copy lives: beside the real file. */
export function sandboxDbPath(): string {
  return path.join(path.dirname(realDbPath()), SANDBOX_FILENAME);
}

function toUrl(p: string): string {
  return `file:${p.split("\\").join("/")}`;
}

export function isSandboxActive(): boolean {
  return enteredAt !== null;
}

/**
 * Delete the sandbox file (and SQLite's side files) once no client holds it.
 * Windows reports EBUSY/EPERM for a short while after `$disconnect`, so retry
 * briefly instead of failing the whole discard/keep.
 */
async function removeSandboxFile(): Promise<void> {
  const base = sandboxDbPath();
  for (const file of [base, `${base}-journal`, `${base}-wal`, `${base}-shm`]) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        break;
      } catch (e: any) {
        if (attempt === 9) throw e;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
}

export async function getSandboxStatus(): Promise<SandboxStatus> {
  if (!isSandboxActive()) {
    return { active: false, enteredAt: null, transactionsAdded: 0 };
  }
  const count = await getClient().accountTransaction.count();
  return {
    active: true,
    enteredAt,
    transactionsAdded: Math.max(0, count - baselineTxnCount),
  };
}

export async function enterSandbox(): Promise<SandboxStatus> {
  if (isSandboxActive()) throw new SandboxError("Sandbox is already active");
  const sandbox = sandboxDbPath();
  // The baseline is counted on the real file before the copy so the two agree.
  baselineTxnCount = await getClient().accountTransaction.count();
  // The copy runs after the real client has disconnected (see switchDatabase)
  // so it can't catch a half-written page.
  const real = realDbPath();
  await switchDatabase(toUrl(sandbox), () => fs.copyFileSync(real, sandbox));
  enteredAt = new Date().toISOString();
  console.log(`[Sandbox] entered — API now on ${sandbox}`);
  return getSandboxStatus();
}

export async function discardSandbox(): Promise<SandboxStatus> {
  if (!isSandboxActive()) throw new SandboxError("Sandbox is not active");
  await switchDatabase(getRealDatabaseUrl());
  enteredAt = null;
  await removeSandboxFile();
  console.log("[Sandbox] discarded — API back on the real database");
  return getSandboxStatus();
}

/**
 * Promote the sandbox to the real database. The real file gets a timestamped
 * `.bak` beside it first (same naming as scripts/db-sync.cjs), so Keep is
 * itself reversible by hand.
 */
export async function keepSandbox(): Promise<SandboxStatus & { backupPath: string }> {
  if (!isSandboxActive()) throw new SandboxError("Sandbox is not active");
  const real = realDbPath();
  const sandbox = sandboxDbPath();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${real}.${stamp}.bak`;

  // switchDatabase disconnects the sandbox client, then runs the copy while
  // no client holds either file, then creates the real client (which opens
  // the freshly overwritten file on its first query).
  await switchDatabase(getRealDatabaseUrl(), () => {
    fs.copyFileSync(real, backupPath);
    fs.copyFileSync(sandbox, real);
  });
  enteredAt = null;
  await removeSandboxFile();
  console.log(`[Sandbox] kept — real database replaced, backup at ${backupPath}`);
  return { ...(await getSandboxStatus()), backupPath };
}

/** Startup hygiene: a sandbox file from a crashed session is never resumed. */
export function cleanupStaleSandbox(): void {
  const base = sandboxDbPath();
  for (const file of [base, `${base}-journal`, `${base}-wal`, `${base}-shm`]) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`[Sandbox] removed stale ${file}`);
      }
    } catch (e: any) {
      console.error(`[Sandbox] could not remove ${file}: ${e.message}`);
    }
  }
}

/** Thrown for caller mistakes (enter twice, discard when inactive) → HTTP 409. */
export class SandboxError extends Error {}
