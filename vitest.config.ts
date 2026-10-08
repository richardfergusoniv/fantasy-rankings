import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["frontend/src/**/*.test.ts", "api/_lib/**/*.test.ts"],
  },
});
