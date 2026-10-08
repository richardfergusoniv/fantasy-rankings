import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./api/_lib/schema.ts",
  out: "./drizzle-pg",
  dialect: "postgresql",
  // Use DATABASE_URL from environment for push/migrate commands.
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
