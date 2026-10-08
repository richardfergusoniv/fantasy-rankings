import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig, loadEnv, type ConfigEnv } from "vite";

const frontendDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(frontendDir, "..");

function envValue(name: string, fileEnv: Record<string, string>): string | undefined {
  return process.env[name] || fileEnv[name] || undefined;
}

/** Copy the canonical or legacy Supabase names into VITE_ when those are unset. */
function fillViteSupabaseEnv(mode: string): void {
  const fileEnv = {
    ...loadEnv(mode, repoRoot, ""),
    ...loadEnv(mode, frontendDir, ""),
  };
  const fill = (viteName: string, fallbacks: readonly string[]) => {
    if (envValue(viteName, fileEnv)) return;
    for (const name of fallbacks) {
      const value = envValue(name, fileEnv);
      if (!value) continue;
      process.env[viteName] = value;
      return;
    }
  };
  fill("VITE_SUPABASE_URL", ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  fill("VITE_SUPABASE_ANON_KEY", ["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
}

export default defineConfig(({ mode }: ConfigEnv) => {
  fillViteSupabaseEnv(mode);
  return {
  // The build runs from the repo root (`vite build --config
  // frontend/vite.config.ts`), so pin the project root to this directory.
  root: frontendDir,
  resolve: {
    alias: {
      "@": resolve(frontendDir, "src"),
    },
  },
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
  };
});
