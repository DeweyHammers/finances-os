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
