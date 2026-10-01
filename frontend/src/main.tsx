import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthGate } from "./Auth";
import "./theme.css";

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
          <App />
        </AuthGate>
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
