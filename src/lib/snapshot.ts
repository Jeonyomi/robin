/**
 * Data snapshot bridge — read-only fallback for deployments when the Neon
 * database is temporarily unavailable or not configured.
 *
 * Flow: `pnpm sync` → queries Neon → builds data/snapshot.json → uploads to Vercel
 * Blob (public store, fixed versioned path) → the deployed API routes fetch
 * that URL. The public URL is baked in as a fallback so the deployment works
 * even without the SNAPSHOT_URL_V3 env var; set SNAPSHOT_URL_V3
 * to override it if the store is ever migrated.
 */
import fs from "node:fs";
import path from "node:path";
import type {
  OverviewData,
  StockTokenRow,
  SyncStateRow,
} from "@/lib/queries";

export interface Snapshot {
  builtAt: string;
  overview: Record<string, OverviewData>;
  stockTokens: Record<string, StockTokenRow[]>;
  syncStates: SyncStateRow[];
}

/** Public Blob store URL the scheduled local sync overwrites. */
const DEFAULT_SNAPSHOT_URL =
  "https://n6bn9jsnnus9uoav.public.blob.vercel-storage.com/robin/public-snapshot-v3.json";

const TTL_MS = 5 * 60 * 1000;
const MAX_SNAPSHOT_AGE_MS = 3 * 60 * 60 * 1000;

let cached: Snapshot | null = null;
let cachedAt = 0;
let lastError: string | null = null;

/** Why the snapshot is unavailable — surfaced in API meta for debugging. */
export function getSnapshotStatus(): { urlConfigured: boolean; lastError: string | null } {
  return { urlConfigured: true, lastError };
}

function freshSnapshot(value: unknown, now = Date.now()): Snapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Snapshot>;
  const builtAt = typeof candidate.builtAt === "string" ? Date.parse(candidate.builtAt) : Number.NaN;
  if (!Number.isFinite(builtAt) || now - builtAt > MAX_SNAPSHOT_AGE_MS || builtAt - now > 5 * 60 * 1000) {
    return null;
  }
  if (!candidate.overview || !candidate.stockTokens || !Array.isArray(candidate.syncStates)) return null;
  return candidate as Snapshot;
}

function snapshotUrl(): string {
  return process.env.SNAPSHOT_URL_V3 || DEFAULT_SNAPSHOT_URL;
}

function localSnapshotPath(): string {
  return path.join(process.cwd(), "data", "snapshot.json");
}

export function snapshotExistsLocally(): boolean {
  return fs.existsSync(localSnapshotPath());
}

/** Load the latest published snapshot (Blob URL first, then local file). */
export async function loadSnapshot(): Promise<Snapshot | null> {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;
  cached = null;

  try {
    const url = new URL(snapshotUrl());
    url.searchParams.set("read", String(Math.floor(now / TTL_MS)));
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      cached = freshSnapshot(await res.json(), now);
      if (cached) {
        cachedAt = Date.now();
        lastError = null;
        return cached;
      }
      lastError = "snapshot-stale-or-invalid";
      console.error("Snapshot rejected because it is stale or invalid");
    } else {
      lastError = `fetch failed: ${res.status}`;
      console.error(`Snapshot fetch failed: ${res.status} ${res.statusText}`);
    }

    if (snapshotExistsLocally()) {
      cached = freshSnapshot(JSON.parse(fs.readFileSync(localSnapshotPath(), "utf8")), now);
      if (cached) {
        cachedAt = Date.now();
        lastError = null;
      }
    }
  } catch (error) {
    lastError = "snapshot-load-failed";
    console.error("Failed to load snapshot:", error);
  }

  return cached;
}

/** Best-effort window lookup with a fallback to the 24h view. */
export function pickWindow<T>(map: Record<string, T> | undefined, window: string): T | undefined {
  if (!map) return undefined;
  return map[window] ?? map["24h"];
}
