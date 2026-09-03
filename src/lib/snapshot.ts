/**
 * Data snapshot bridge — lets the UI-only Vercel deployment serve the same
 * payloads that the local machine produces.
 *
 * Flow: `pnpm sync` (locally) → builds data/snapshot.json → uploads to Vercel
 * Blob (public store, fixed `robin/snapshot.json` path) → the deployed API
 * routes fetch that URL. The public URL is baked in as a fallback so the
 * deployment works even without the SNAPSHOT_URL env var; set SNAPSHOT_URL
 * to override it if the store is ever migrated.
 */
import fs from "node:fs";
import path from "node:path";
import type {
  OverviewData,
  StockTokenRow,
  TokenDetailData,
  TokensScannerItem,
  SyncStateRow,
} from "@/lib/queries";

export interface Snapshot {
  builtAt: string;
  overview: Record<string, OverviewData>;
  stockTokens: Record<string, StockTokenRow[]>;
  tokenDetails: Record<string, TokenDetailData>;
  tokensScanner: TokensScannerItem[];
  syncStates: SyncStateRow[];
}

/** Public Blob store URL the hourly local sync overwrites. */
const DEFAULT_SNAPSHOT_URL =
  "https://n6bn9jsnnus9uoav.public.blob.vercel-storage.com/robin/snapshot.json";

const TTL_MS = 5 * 60 * 1000;

let cached: Snapshot | null = null;
let cachedAt = 0;
let lastError: string | null = null;

/** Why the snapshot is unavailable — surfaced in API meta for debugging. */
export function getSnapshotStatus(): { urlConfigured: boolean; lastError: string | null } {
  return { urlConfigured: true, lastError };
}

function snapshotUrl(): string {
  return process.env.SNAPSHOT_URL || DEFAULT_SNAPSHOT_URL;
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
    const url = snapshotUrl();
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (res.ok) {
      cached = (await res.json()) as Snapshot;
      cachedAt = Date.now();
      lastError = null;
      return cached;
    }
    lastError = `fetch failed: ${res.status} ${res.statusText}`;
    console.error(`Snapshot fetch failed: ${res.status} ${res.statusText}`);

    if (snapshotExistsLocally()) {
      cached = JSON.parse(fs.readFileSync(localSnapshotPath(), "utf8")) as Snapshot;
      cachedAt = Date.now();
      lastError = null;
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error("Failed to load snapshot:", error);
  }

  return cached;
}

/** Best-effort window lookup with a fallback to the 24h view. */
export function pickWindow<T>(map: Record<string, T> | undefined, window: string): T | undefined {
  if (!map) return undefined;
  return map[window] ?? map["24h"];
}
