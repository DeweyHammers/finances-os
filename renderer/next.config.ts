/**
 * next.config.ts — Next.js config tuned for Nextron (Electron packaging).
 *
 * The renderer is compiled to a static export so Electron can load it from the
 * local filesystem via file:// — there's no Node server at runtime. Every
 * setting below exists to satisfy that constraint or to keep the build
 * compatible with Nextron's expected layout.
 */

import { NextConfig } from 'next'

const isProd = process.env.NODE_ENV === 'production'
// The Android app (capacitor.config.ts → webDir) gets its own export folder
// so a phone build never overwrites the desktop's `app/`. Only
// scripts/android/build-web.mjs sets this; the desktop path is unchanged.
const isAndroid = process.env.FINANCES_OS_RENDERER_TARGET === 'android'

const config: NextConfig = {
  // Static HTML/JS export — required by Electron packaging. No SSR, no API
  // routes; all data flows through IPC to the main process (see providers.tsx).
  output: 'export',
  // In production, emit the build one level up into ../app so Nextron's main
  // process can package it alongside the Electron entry. In dev, keep the
  // default .next so `npm run dev` hot-reload still works. (With `output:
  // 'export'` Next writes the static files INTO distDir whenever it isn't
  // the default `.next`.)
  distDir: isAndroid ? '../app-android' : isProd ? '../app' : '.next',
  // Trailing slashes make the exported directory structure serve cleanly from
  // file:// URLs (each route becomes /Route/index.html rather than /Route.html).
  trailingSlash: true,
  images: {
    // next/image's optimizer needs a running Node server; static export can't
    // provide that, so images must be served as-is.
    unoptimized: true,
  },
  // Native SQLite drivers that must not be bundled by webpack — they need to
  // resolve at runtime from node_modules in the packaged app.
  serverExternalPackages: ['libsql', '@libsql/client'],
  // Suppress the dev-mode overlay indicators (the Nextron window has its own
  // chrome and the indicators overlap our layout).
  devIndicators: false,
}

export default config

