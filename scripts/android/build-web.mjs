#!/usr/bin/env node
/**
 * build-web.mjs — build the renderer for the Android app and copy it into
 * the Capacitor project (`npm run android:web`).
 *
 *   1. `next build renderer` with FINANCES_OS_RENDERER_TARGET=android, which
 *      makes renderer/next.config.ts write the static export to
 *      `app-android/` (capacitor.config.ts → webDir) instead of the
 *      desktop's `app/`. Nothing about the desktop build changes.
 *   2. `cap sync android` copies that export into
 *      android/app/src/main/assets/public and refreshes the plugin list the
 *      Gradle build reads.
 *
 * No Android toolchain is needed for this step; build-apk.mjs (or the
 * release workflow) runs Gradle afterwards.
 */
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const webDir = path.join(repoRoot, "app-android");

/** Run a command from the repo root, inheriting output; exit on failure. */
export function run(command, args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  // The renderer must not be told to talk to a demo API on another port: on
  // the phone every call is answered in-process (renderer/lib/local-api).
  delete env.NEXT_PUBLIC_API_URL;
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`\n${command} ${args.join(" ")} failed (exit ${result.status ?? "signal"}).`);
    process.exit(result.status ?? 1);
  }
}

export function buildWeb() {
  rmSync(webDir, { recursive: true, force: true });
  run("npx", ["next", "build", "renderer"], {
    NODE_ENV: "production",
    FINANCES_OS_RENDERER_TARGET: "android",
  });
  if (!existsSync(path.join(webDir, "index.html"))) {
    console.error(`next build did not produce ${webDir}/index.html — check renderer/next.config.ts (distDir).`);
    process.exit(1);
  }
  run("npx", ["cap", "sync", "android"]);
  console.log(`\nRenderer exported to ${webDir} and copied into android/.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildWeb();
}
