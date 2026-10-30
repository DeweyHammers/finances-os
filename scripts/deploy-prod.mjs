// deploy-prod.mjs — ship the current code to the INSTALLED Finances OS on this
// PC by swapping its JavaScript bundle (resources/app.asar) in place.
//
//   npm run deploy:prod                  # build, verify, swap, relaunch
//   npm run deploy:prod -- --check       # build + verify only; touches nothing
//   npm run deploy:prod -- --skip-build  # reuse dist/win-unpacked from the last build
//
// Why this exists (Oct 2026): Windows Smart App Control on this PC refuses to
// run unsigned installers — electron-builder's NSIS stub, a Setup exe from a
// browser download, and electron-updater's silent install alike — and the
// free code-signing route (SignPath Foundation) declined the project, so
// there are no installers, GitHub Releases or in-app updates any more. What
// DOES work is replacing the app's JavaScript: app.asar is data, not an
// executable, so nothing new has to pass Code Integrity. The same Electron
// binary and the same native modules keep running underneath.
//
// The flip side: this path can never ship a new binary. Every file under
// resources/app.asar.unpacked (libsql's native addon) and the Electron
// executable itself must be byte-identical to what is installed, or the
// script refuses. A new Electron or libsql version then needs a real
// installer (signed, or Smart App Control turned off — the user's call).
//
// The database (%APPDATA%\finances-os\database.db) is never touched; a
// schema change still goes through `npm run db:push` separately, before this.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has("--check");
const SKIP_BUILD = args.has("--skip-build");

const INSTALL_DIR =
  process.env.FINANCES_OS_INSTALL_DIR ?? path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Finances OS");
const EXE_NAME = "Finances OS.exe";
const BUILD_DIR = path.join(ROOT, "dist", "win-unpacked");
const API_META = "http://127.0.0.1:5858/api/meta";
/** The one unpacked file allowed to differ: it is only read on a fresh install. */
const UNPACKED_IGNORE = new Set(["prisma/template.db"]);

const log = (m = "") => console.log(m);
const fail = (m) => {
  console.error(`\n✖ ${m}`);
  process.exit(1);
};

function run(label, command, cmdArgs, env = {}) {
  log(`\n▶ ${label}`);
  // One command string: npx/node are .cmd shims on Windows, so a shell is
  // needed, and Node warns when args are passed separately with shell: true.
  const r = spawnSync([command, ...cmdArgs].join(" "), { stdio: "inherit", shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) fail(`${label} failed (exit ${r.status}).`);
}

function isAppRunning() {
  const r = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${EXE_NAME}`, "/NH"], { encoding: "utf8" });
  return (r.stdout ?? "").toLowerCase().includes(EXE_NAME.toLowerCase());
}

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Every file below `dir`, as forward-slash paths relative to it. */
function walk(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

// electron-builder's own asar reader (a dependency of app-builder-lib), so
// nothing has to be extracted to disk.
const asar = (() => {
  try {
    return createRequire(import.meta.url)("@electron/asar");
  } catch {
    return null;
  }
})();
if (!asar) fail("@electron/asar is not installed (it comes with electron-builder). Run npm ci.");

const asarVersion = (file) => JSON.parse(asar.extractFile(file, "package.json").toString("utf8")).version;
const asarHas = (list, rel) => list.includes(`/${rel}`) || list.includes(`\\${rel.replace(/\//g, "\\")}`);

// ── Preconditions ────────────────────────────────────────────────────────────
const installedAsar = path.join(INSTALL_DIR, "resources", "app.asar");
const installedExe = path.join(INSTALL_DIR, EXE_NAME);
if (!fs.existsSync(installedAsar) || !fs.existsSync(installedExe)) {
  fail(`No installed app at ${INSTALL_DIR} (set FINANCES_OS_INSTALL_DIR if it lives elsewhere).`);
}
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const installedVersion = asarVersion(installedAsar);
log(`Installed: ${installedVersion} at ${INSTALL_DIR}`);
log(`Source:    ${pkg.version} at ${ROOT}${CHECK_ONLY ? "   (--check: nothing will be written)" : ""}`);

// ── Build ────────────────────────────────────────────────────────────────────
if (SKIP_BUILD) {
  log("\n▶ Build skipped (--skip-build); using dist/win-unpacked as it is.");
} else {
  // The same three steps as `npm run build`, minus the NSIS installer that
  // Smart App Control blocks. `prebuild` rebuilds prisma/template.db EMPTY
  // and refuses to continue otherwise, so the bundle never carries data.
  run("Rebuild the empty template database", "node", ["scripts/build-template-db.mjs"]);
  run("Build renderer + main (nextron)", "npx", ["nextron", "build", "--no-pack"]);
  run("Package dist/win-unpacked (electron-builder --dir)", "npx", ["electron-builder", "--dir", "--publish", "never"], {
    ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES: "true",
  });
}

// ── Verify ───────────────────────────────────────────────────────────────────
log("\n▶ Verify the build against the installed app");
const newAsar = path.join(BUILD_DIR, "resources", "app.asar");
if (!fs.existsSync(newAsar)) fail(`${newAsar} is missing — did the build run?`);

// 1. The bundle carries the version we think it does.
const newVersion = asarVersion(newAsar);
if (newVersion !== pkg.version) fail(`app.asar says version ${newVersion}, package.json says ${pkg.version}.`);
log(`  ✓ app.asar is version ${newVersion}`);

// 2. Every runtime dependency made it into the bundle (a stale node_modules
//    once built an asar without one, and the app crashed on launch).
const asarList = asar.listPackage(newAsar);
const unpackedNew = path.join(BUILD_DIR, "resources", "app.asar.unpacked");
const missing = Object.keys(pkg.dependencies ?? {})
  .filter((name) => !name.startsWith("@types/"))
  .filter(
    (name) =>
      !asarHas(asarList, `node_modules/${name}/package.json`) &&
      !fs.existsSync(path.join(unpackedNew, "node_modules", name, "package.json")),
  );
if (missing.length) fail(`Dependencies missing from app.asar: ${missing.join(", ")}. Run npm ci and build again.`);
log(`  ✓ all ${Object.keys(pkg.dependencies ?? {}).length} runtime dependencies are in the bundle`);

// 3. Nothing native changed: app.asar.unpacked must match file for file.
const unpackedOld = path.join(INSTALL_DIR, "resources", "app.asar.unpacked");
const filesNew = fs.existsSync(unpackedNew) ? walk(unpackedNew) : [];
const filesOld = fs.existsSync(unpackedOld) ? walk(unpackedOld) : [];
const nativeProblems = [];
for (const rel of new Set([...filesNew, ...filesOld])) {
  if (UNPACKED_IGNORE.has(rel)) continue;
  const a = path.join(unpackedNew, rel);
  const b = path.join(unpackedOld, rel);
  if (!fs.existsSync(a)) nativeProblems.push(`${rel}: installed but not in the new build`);
  else if (!fs.existsSync(b)) nativeProblems.push(`${rel}: in the new build but not installed`);
  else if (sha256(a) !== sha256(b)) nativeProblems.push(`${rel}: contents differ`);
}
if (nativeProblems.length) {
  fail(
    `app.asar.unpacked differs from the installed app — this path cannot ship new binaries:\n  - ${nativeProblems.join("\n  - ")}\n` +
      `  A native dependency changed; a real installer is needed (see the comment at the top of this script).`,
  );
}
log(`  ✓ app.asar.unpacked is identical (${filesOld.length} files${filesOld.some((f) => UNPACKED_IGNORE.has(f)) ? ", template.db ignored" : ""})`);

// 4. Same Electron: the executable the bundle will run inside. The two exes
//    are never byte-identical — electron-builder writes a hash of the asar
//    into the exe as a small resource ("updating asar integrity executable
//    resource"; not enforced at runtime, which is why the swap works at all) —
//    so "same" means: same length, and the differing bytes fit inside that
//    resource. A different Electron changes far more than that.
const newExe = path.join(BUILD_DIR, EXE_NAME);
if (!fs.existsSync(newExe)) fail(`${newExe} is missing.`);
const EXE_DIFF_LIMIT = 4096;
{
  const a = fs.readFileSync(newExe);
  const b = fs.readFileSync(installedExe);
  let differing = a.length === b.length ? 0 : Infinity;
  for (let i = 0; differing < Infinity && i < a.length; i++) if (a[i] !== b[i]) differing++;
  if (differing > EXE_DIFF_LIMIT) {
    fail(`${EXE_NAME} differs between the build and the installed app (an Electron upgrade?) — a real installer is needed.`);
  }
  log(`  ✓ ${EXE_NAME} is the same Electron build (${differing} bytes differ: the embedded asar-integrity resource)`);
}

if (CHECK_ONLY) {
  log(`\n✓ Ready: ${installedVersion} → ${newVersion}. Close the app and run without --check to deploy.`);
  process.exit(0);
}

// ── Swap ─────────────────────────────────────────────────────────────────────
if (isAppRunning()) fail(`${EXE_NAME} is running. Close Finances OS first (its asar is locked while it runs).`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
let backup = `${installedAsar}.${installedVersion}.bak`;
if (fs.existsSync(backup)) backup = `${installedAsar}.${installedVersion}.${stamp}.bak`;
fs.copyFileSync(installedAsar, backup);
log(`\n▶ Backed up the installed bundle → ${path.basename(backup)}`);
fs.copyFileSync(newAsar, installedAsar);
log(`▶ Installed app.asar ${installedVersion} → ${newVersion}`);

// ── Relaunch and confirm ─────────────────────────────────────────────────────
log(`\n▶ Starting ${EXE_NAME} and waiting for its API…`);
spawn(installedExe, [], { detached: true, stdio: "ignore", cwd: INSTALL_DIR }).unref();
let reported = null;
for (let i = 0; i < 60 && !reported; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    const res = await fetch(API_META);
    if (res.ok) reported = (await res.json()).version;
  } catch {
    /* not up yet */
  }
}
if (!reported) fail(`The app did not answer on ${API_META} within 60 s. Check %APPDATA%\\finances-os\\app.log.`);
if (reported !== newVersion) fail(`The running app reports ${reported}, expected ${newVersion}.`);
log(`\n✓ Finances OS ${reported} is running. Previous bundle kept as ${path.basename(backup)}.`);
