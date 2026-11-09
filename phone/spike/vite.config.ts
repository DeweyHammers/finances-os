/**
 * Vite config for the SPIKE page only (plans/phone-app.md, step 1):
 *   npx vite --config phone/spike/vite.config.ts
 * Serves phone/spike on http://localhost:8890. The page imports the shared
 * data layer from the repo root, so the dev server may read up to there.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  // The spike has no build output and no cache worth keeping in the repo.
  cacheDir: path.resolve(here, "../../node_modules/.vite-phone-spike"),
  server: {
    port: 8890,
    strictPort: true,
    host: "localhost",
    fs: { allow: [path.resolve(here, "../..")] },
  },
});
