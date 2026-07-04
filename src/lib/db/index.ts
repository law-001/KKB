import { loadEnvConfig } from "@next/env";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// Loads .env.local when running outside Next.js (scripts, drizzle-kit).
// No-op in the Next.js runtime where env vars are already set.
loadEnvConfig(process.cwd());

// Next dev's Fast Refresh re-executes this module on almost every save; a
// plain module-scope client would open a fresh connection pool each time
// and never close the old one, eventually exhausting Supabase's pooler
// connection cap. Cache the client on `globalThis` across reloads, the same
// trick used for Prisma clients in Next.js dev.
declare global {
  var __kkbPgClient: postgres.Sql | undefined;
}

// Supabase's pooled (Supavisor transaction-mode) connection string.
// `prepare: false` is required in transaction-pooling mode — the pooler
// rotates the underlying connection per statement, so named prepared
// statements can't be reused across calls. `max` kept low since Supavisor
// is already multiplexing many app-side connections over few real ones.
const client =
  global.__kkbPgClient ??
  postgres(process.env.DATABASE_URL!, { prepare: false, max: 5 });

if (process.env.NODE_ENV !== "production") {
  global.__kkbPgClient = client;
}

export const db = drizzle(client, { schema });
export type DB = typeof db;
export * as tables from "./schema";
