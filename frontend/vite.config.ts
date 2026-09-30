import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
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
