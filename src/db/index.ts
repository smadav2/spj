import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

type SpjDatabase = ReturnType<typeof drizzle>;

const globalForDb = globalThis as typeof globalThis & {
  __spjPool?: Pool;
  __spjDb?: SpjDatabase;
};

export const MISSING_DATABASE_URL =
  "DATABASE_URL belum diatur. Tambahkan connection string PostgreSQL (Neon/Supabase) pada environment variable server, lalu deploy ulang.";

function createPool(): Pool {
  const databaseUrl = process.env.DATABASE_URL;
  // Never throw at import time: `next build` evaluates these modules while
  // collecting page data, and on Vercel build-time env vars may be absent.
  if (!databaseUrl) throw new Error(MISSING_DATABASE_URL);
  // Vercel runs each function in its own isolated process, so keep the pool small
  // and point DATABASE_URL at the provider's *pooled* endpoint (e.g., Neon pooler).
  return new Pool({ connectionString: databaseUrl, max: process.env.VERCEL === "1" ? 3 : 10 });
}

export function getPool(): Pool {
  if (!globalForDb.__spjPool) globalForDb.__spjPool = createPool();
  return globalForDb.__spjPool;
}

export function getDb(): SpjDatabase {
  if (!globalForDb.__spjDb) globalForDb.__spjDb = drizzle(getPool());
  return globalForDb.__spjDb;
}

// Lazy proxies keep the previous `db` / `pool` import style working while the
// actual connection is created on first query (never during the build).
export const db: SpjDatabase = new Proxy({} as SpjDatabase, {
  get(_target, property) {
    const instance = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = instance[property];
    return typeof value === "function" ? value.bind(instance) : value;
  },
  has(_target, property) {
    return property in (getDb() as unknown as Record<PropertyKey, unknown>);
  },
});

export const pool: Pool = new Proxy({} as Pool, {
  get(_target, property) {
    const instance = getPool() as unknown as Record<PropertyKey, unknown>;
    const value = instance[property];
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
