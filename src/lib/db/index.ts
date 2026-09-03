import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { env } from "@/lib/config";
import fs from "node:fs";
import path from "node:path";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

const DEFAULT_DB_PATH = "data/robin.db";

function ensureDbFile(): string {
  // Explicit override wins; otherwise use local SQLite file
  const configured = env.DATABASE_URL;
  if (configured && configured.startsWith("sqlite:")) {
    return configured.replace("sqlite:", "");
  }
  const dbPath = configured || DEFAULT_DB_PATH;
  const abs = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return abs;
}

export function getDb() {
  if (_db) return _db;

  const dbPath = ensureDbFile();

  // better-sqlite3 (synchronous, file-based) — data stays on this machine
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  _db = drizzle(sqlite, { schema });
  return _db;
}

/** True when a local DB file exists (used by API routes to decide responses) */
export function hasLocalDb(): boolean {
  try {
    const dbPath = ensureDbFile();
    return fs.existsSync(dbPath);
  } catch {
    return false;
  }
}
