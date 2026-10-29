/**
 * platform.ts — THE runtime switch between "the renderer talks to a server"
 * and "the renderer IS the app" (Phase C of plans/phone-app-and-sync.md).
 *
 *   browser / Electron  →  every call goes over HTTP to the loopback API
 *                          (main/api-server.ts), exactly as before.
 *   native (Capacitor)  →  the Android app has no server: the data layer runs
 *                          in the WebView against the phone's own SQLite
 *                          (lib/local-api), and the non-resource calls are
 *                          answered in-process.
 *
 * Only two places read it: app/providers.tsx (which data provider Refine
 * gets) and lib/local-api → apiFetch (where the raw fetches go). Everything
 * else — Settings included — keys off what those answer (`AppMeta.mode` is
 * "android" on the phone), never off the platform itself.
 *
 * `NEXT_PUBLIC_IN_PROCESS_DATA=1` forces the native path in a desktop
 * browser: the same executor then runs on @capacitor-community/sqlite's web
 * engine (jeep-sqlite + sql.js), which is how the phone data path is checked
 * on a PC without an Android toolchain (see CLAUDE.md → "Android app").
 */
import { Capacitor } from "@capacitor/core";

/** True inside the Capacitor app (or when the browser check forces it). */
export function isNativeApp(): boolean {
  if (process.env.NEXT_PUBLIC_IN_PROCESS_DATA === "1") return true;
  return Capacitor.isNativePlatform();
}

/** "android" in the app, "web" in a browser (Capacitor's own name). */
export function platformName(): string {
  return Capacitor.getPlatform();
}
