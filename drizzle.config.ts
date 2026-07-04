import { defineConfig } from "drizzle-kit";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Direct (non-pooled) connection — DDL needs a session-mode connection,
  // not the transaction-mode pooler used by the app at runtime.
  dbCredentials: {
    url: process.env.DIRECT_URL!,
  },
});
