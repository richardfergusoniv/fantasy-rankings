import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";

const frontendDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // The build runs from the repo root (`vite build --config
  // frontend/vite.config.ts`), so pin the project root to this directory.
  root: frontendDir,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(frontendDir, "dist"),
    emptyOutDir: true,
    sourcemap: false,
    // The dashboard payload is large; raise the chunk warning limit.
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: {
      // During local dev, forward API calls to the dev server.
      "/api": "http://localhost:3000",
    },
  },
});
