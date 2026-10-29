/**
 * smart-app-control.ts — is Windows 11's Smart App Control enforced on this
 * PC?
 *
 * Why the app cares (Oct 29 2026, the first live in-app update): Smart App
 * Control refuses to run an UNSIGNED installer that another program starts.
 * electron-updater's `quitAndInstall` spawned the downloaded NSIS installer,
 * got `spawn UNKNOWN` (Code Integrity event 3077), retried through
 * elevate.exe (the UAC prompt the user saw), was blocked again, and then quit
 * the app as if the install had begun — "nothing happens". Adding the
 * browser's "from the internet" zone mark to the file did not help: the
 * reputation lookup happens inside the browser at download time, which an
 * in-app download can't take part in. A browser-downloaded installer from
 * the Release page does run (that is how v1.3.0 was installed on the same
 * PC), so while Smart App Control is on, that is the update path, and the
 * Settings row has to say so instead of offering Download.
 *
 * The state lives in the registry, readable without elevation:
 *   HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy
 *     VerifiedAndReputablePolicyState  REG_DWORD  1 = on, 2 = evaluation, 0 = off
 * It is read with `reg query` (no native module), once, at startup. A
 * missing value (Windows 10, an older build) reads as "off"; a failed read
 * as "unknown", which the caller treats like "off" — a wrong "on" would hide
 * a working Download button, a wrong "off" only re-creates today's failure.
 *
 * No Electron imports, so the parser is unit-tested and the module loads in
 * the hosted server and the tests.
 */
import { execFile } from "node:child_process";

export type SmartAppControlState = "on" | "evaluation" | "off" | "unknown";

const REG_KEY = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy";
const REG_VALUE = "VerifiedAndReputablePolicyState";

/** The signature of the one command this module runs (swapped in tests). */
export type RunCommand = (file: string, args: string[]) => Promise<{ stdout: string; code: number }>;

const defaultRun: RunCommand = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      // `reg query` exits 1 when the key or value is missing — not an error here.
      const code = error ? Number((error as NodeJS.ErrnoException & { code?: number | string }).code) || 1 : 0;
      resolve({ stdout: String(stdout ?? ""), code });
    });
  });

/**
 * Parse `reg query … /v VerifiedAndReputablePolicyState` output:
 *   HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\CI\Policy
 *       VerifiedAndReputablePolicyState    REG_DWORD    0x1
 * Exported for the tests; `null` when the value line is not there.
 */
export function parseSmartAppControlState(stdout: string): SmartAppControlState | null {
  const m = /VerifiedAndReputablePolicyState\s+REG_DWORD\s+(0x[0-9a-f]+|\d+)/i.exec(stdout);
  if (!m) return null;
  const n = Number(m[1]);
  if (n === 1) return "on";
  if (n === 2) return "evaluation";
  if (n === 0) return "off";
  return "unknown";
}

/**
 * Read the state. Not Windows → "off" (the setting doesn't exist). The value
 * missing → "off" (Windows without the feature). Command failed → "unknown".
 */
export async function readSmartAppControlState(
  platform: NodeJS.Platform = process.platform,
  run: RunCommand = defaultRun,
): Promise<SmartAppControlState> {
  if (platform !== "win32") return "off";
  try {
    const { stdout, code } = await run("reg", ["query", REG_KEY, "/v", REG_VALUE]);
    const parsed = parseSmartAppControlState(stdout);
    if (parsed) return parsed;
    return code === 1 ? "off" : "unknown";
  } catch {
    return "unknown";
  }
}
