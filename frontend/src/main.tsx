import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { App } from "./App";
import { AuthGate } from "./Auth";
import { FeatureErrorBoundary } from "./error-boundary";
import { initPostHog } from "./posthog";
import "./theme.css";

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
          <FeatureErrorBoundary title="Fantasy Rankings didn’t load." onRetry={() => window.location.reload()}>
            <App />
          </FeatureErrorBoundary>
        </AuthGate>
        <Toaster />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
