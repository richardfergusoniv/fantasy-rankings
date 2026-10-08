import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "frontend/dist/**",
      "app/**",
      "drizzle-pg/**",
      "pipeline/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    // `lib/` besides `schema.ts` is the unused copy of `api/_lib/`.
    // It is left out here so lint matches the code the routes actually run.
    files: ["frontend/src/**/*.{ts,tsx}", "api/**/*.ts", "lib/schema.ts"],
    rules: {
      // `_args` and `_req` are placeholders so call sites can pass `{}` or
      // keep a route signature without using the value.
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
    },
  },
);
