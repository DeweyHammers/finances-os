import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
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
