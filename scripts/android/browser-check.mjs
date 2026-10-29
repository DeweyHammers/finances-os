#!/usr/bin/env node
/**
 * browser-check.mjs — run the PHONE data path in a desktop browser
 * (`npm run android:browser`), for a PC without an Android toolchain.
 *
 * Starts `next dev` on port 8889 with NEXT_PUBLIC_IN_PROCESS_DATA=1, which
 * flips the renderer's runtime switch (renderer/lib/platform.ts) to the
 * in-process API: Refine talks to the data layer through
 * renderer/lib/local-api, and the SQLite plugin runs on its web engine
 * (jeep-sqlite + sql.js, persisted in the browser's IndexedDB). The engine
 * needs sql.js's wasm at /assets/sql-wasm.wasm, so it is copied from
 * node_modules into renderer/public first (gitignored). `sql.js` is pinned
 * to 1.12.0 in package.json on purpose: jeep-sqlite 2.8.0 bundles the sql.js
 * JS glue of that generation (34 wasm imports); the wasm of 1.13+ expects
 * more imports and fails to link ("Import #34 a.I requires a callable").
 *
 * Nothing here touches dev.db, PROD or the API server: the browser tab is
 * its own little phone. Open http://localhost:8889 at a phone size.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { repoRoot, run } from "./build-web.mjs";

const wasmSource = path.join(repoRoot, "node_modules", "sql.js", "dist", "sql-wasm.wasm");
const wasmTarget = path.join(repoRoot, "renderer", "public", "assets", "sql-wasm.wasm");
mkdirSync(path.dirname(wasmTarget), { recursive: true });
copyFileSync(wasmSource, wasmTarget);
console.log(`Copied sql.js wasm to ${path.relative(repoRoot, wasmTarget)}`);

const port = process.env.PORT ?? "8889";
run("npx", ["next", "dev", "-p", port, "renderer"], { NEXT_PUBLIC_IN_PROCESS_DATA: "1" });
