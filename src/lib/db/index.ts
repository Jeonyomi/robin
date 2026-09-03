import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";
import { env } from "@/lib/config";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (_db) return _db;

  // env is a lazy Proxy — validated only on first property access
  const url = env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not set. Configure it in your Vercel project settings.");
  }

  const sql = neon(url);
  _db = drizzle(sql, { schema });
  return _db;
}
