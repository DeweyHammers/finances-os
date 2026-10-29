#!/usr/bin/env node
/**
 * build-apk.mjs — build the Android APK (`npm run android:apk`), the same
 * way the release workflow does, so CI and a developer PC can't drift.
 *
 *   npm run android:apk              debug APK (signed with the local debug
 *                                    key Gradle generates; installable, but a
 *                                    release APK won't install over it)
 *   npm run android:apk -- --release release APK signed with the keystore
 *                                    named by these environment variables:
 *                                      ANDROID_KEYSTORE_FILE      path to the .jks
 *                                      ANDROID_KEYSTORE_PASSWORD
 *                                      ANDROID_KEY_ALIAS
 *                                      ANDROID_KEY_PASSWORD
 *   add --skip-web                   reuse the last `android:web` output
 *
 * Needs a JDK (21) and the Android SDK (ANDROID_HOME) — neither is part of
 * this repo's npm install. See docs/android-release.md.
 *
 * The result is copied to dist-android/Finances-OS-<version>.apk (or
 * -debug.apk), the name the Release carries.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildWeb, repoRoot } from "./build-web.mjs";

const args = new Set(process.argv.slice(2));
const release = args.has("--release");

if (!args.has("--skip-web")) buildWeb();

const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const gradleArgs = [release ? "assembleRelease" : "assembleDebug", "--no-daemon"];

if (release) {
  const need = ["ANDROID_KEYSTORE_FILE", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"];
  const missing = need.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`A release APK needs the signing variables ${missing.join(", ")} (see docs/android-release.md).`);
    process.exit(1);
  }
  const keystore = path.resolve(process.env.ANDROID_KEYSTORE_FILE);
  if (!existsSync(keystore)) {
    console.error(`Keystore not found: ${keystore}`);
    process.exit(1);
  }
  // The Android Gradle plugin's "injected" signing properties — what Android
  // Studio's "Generate Signed APK" uses — so build.gradle never has to know
  // about secrets.
  gradleArgs.push(
    `-Pandroid.injected.signing.store.file=${keystore}`,
    `-Pandroid.injected.signing.store.password=${process.env.ANDROID_KEYSTORE_PASSWORD}`,
    `-Pandroid.injected.signing.key.alias=${process.env.ANDROID_KEY_ALIAS}`,
    `-Pandroid.injected.signing.key.password=${process.env.ANDROID_KEY_PASSWORD}`,
  );
}

const androidDir = path.join(repoRoot, "android");
const result = spawnSync(gradlew, gradleArgs, {
  cwd: androidDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.status !== 0) {
  console.error(`\nGradle failed (exit ${result.status ?? "signal"}).`);
  process.exit(result.status ?? 1);
}

const version = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
const built = path.join(
  androidDir,
  "app/build/outputs/apk",
  release ? "release/app-release.apk" : "debug/app-debug.apk",
);
if (!existsSync(built)) {
  console.error(`Gradle finished but ${built} is missing (an unsigned release build is named app-release-unsigned.apk).`);
  process.exit(1);
}
const outDir = path.join(repoRoot, "dist-android");
mkdirSync(outDir, { recursive: true });
const target = path.join(outDir, `Finances-OS-${version}${release ? "" : "-debug"}.apk`);
copyFileSync(built, target);
console.log(`\nAPK: ${target}`);
