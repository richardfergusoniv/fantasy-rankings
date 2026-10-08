import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "frontend/dist/**",
      "app/**",
      "drizzle-pg/**",
      "pipeline/**",
      "lib/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    // `lib/` is the unused copy of `api/_lib/`, including the schema.
    files: ["frontend/src/**/*.{ts,tsx}", "api/**/*.ts"],
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
