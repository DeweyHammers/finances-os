import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    // A GitHub-hosted runner can stall for seconds at a time: on Oct 30 2026
    // three unrelated beforeEach hooks (table wipe, GC + tick close, mock
    // bootstrap) blew the default 10 s at the same moment while the twin run
    // of the same commit passed. Locally the defaults stay, so a real hang
    // still shows up fast.
    hookTimeout: process.env.CI ? 60_000 : 10_000,
    testTimeout: process.env.CI ? 30_000 : 5_000,
    // One test file at a time on the runner (2 cores, ~7 GB): with files in
    // parallel the libsql-heavy ones (route tests, sync tests, store tests)
    // run beside several jsdom workers, and on Oct 30 2026 that killed the
    // sync test file's worker outright ("Worker exited unexpectedly", no JS
    // error — a native crash or an OOM) in a run whose twin had passed.
    // Locally — the pre-push hook included, which sets CI=true too — the
    // files still run in parallel, hence GITHUB_ACTIONS rather than CI.
    fileParallelism: !process.env.GITHUB_ACTIONS,
    include: [
      "renderer/**/*.test.{ts,tsx}",
      "main/**/*.test.ts",
      "shared/**/*.test.ts",
      "tests/**/*.test.{ts,tsx}",
    ],
    coverage: {
      include: [
        "renderer/lib/**/*.ts",
        "main/api-server.ts",
      ],
      exclude: ["**/*.test.*", "**/node_modules/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./renderer"),
    },
  },
});
