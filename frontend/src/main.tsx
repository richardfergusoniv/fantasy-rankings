import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { AuthGate } from "./Auth";
import { initPostHog } from "./posthog";
import "./theme.css";

// The app is loaded on demand so the signed-out auth/bootstrap path doesn't
// pay for the full dashboard bundle up front.
const LazyApp = lazy(() => import("./App").then((module) => ({ default: module.App })));

initPostHog();

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("missing root element");
}

// Standard React Query client (replaces @hatch/space-sdk's spaceQueryClient).
// The `hatch-space-root` wrapper is preserved for the safe-area / viewport
// styles in theme.css that select on it.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
    },
  },
});

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <div className="hatch-space-root" data-hatch-space-root>
        <AuthGate>
          <Suspense
            fallback={
              <div className="flex min-h-dvh items-center justify-center bg-background px-4 text-sm text-muted-foreground">
                <p>Loading…</p>
              </div>
            }
          >
            <LazyApp />
          </Suspense>
        </AuthGate>
        <Toaster />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
