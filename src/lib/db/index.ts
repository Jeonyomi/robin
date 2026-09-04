import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";
import { env } from "@/lib/config";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function requireDatabaseUrl(): string {
  const url = env.DATABASE_URL.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not configured. Connect Neon through the Vercel Marketplace or set a Neon Postgres connection string locally.",
    );
  }
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  }
  return url;
}

/** Lazy Neon HTTP client, safe for Next.js serverless route handlers and local sync scripts. */
export function getDb() {
  if (_db) return _db;

  const sql = neon(requireDatabaseUrl());
  _db = drizzle(sql, { schema });
  return _db;
}

/** True when a Cloud Postgres connection is configured. */
export function hasDatabase(): boolean {
  return /^postgres(ql)?:\/\//i.test(env.DATABASE_URL.trim());
}
