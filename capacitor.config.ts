/**
 * capacitor.config.ts — the Android app (Phase C of plans/phone-app-and-sync.md).
 *
 * Capacitor wraps the renderer's static export in a WebView and ships it as an
 * APK built by GitHub Actions (.github/workflows/release.yml → "android").
 * `webDir` is where `scripts/android/build-web.mjs` tells Next to write the
 * export (renderer/next.config.ts: `FINANCES_OS_RENDERER_TARGET=android`);
 * the desktop build keeps writing to `app/` and never reads this file.
 *
 * The Android package name can't contain a hyphen, hence `financesos` where
 * the desktop appId (electron-builder.yml) has `finances-os`.
 */
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.richarddeweyhammers.financesos",
  appName: "Finances OS",
  webDir: "app-android",
  // The renderer's canvas colour (slate-900): shown behind the WebView while
  // the first page loads instead of a white flash.
  backgroundColor: "#0f172a",
  plugins: {
    // @capacitor-community/sqlite: a plain, unencrypted local database (the
    // phone's own storage is already per-app); no biometric gate.
    CapacitorSQLite: {
      androidIsEncryption: false,
      androidBiometric: { biometricAuth: false },
    },
  },
};

export default config;
