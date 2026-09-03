/**
 * Data snapshot bridge — lets the UI-only Vercel deployment serve the same
 * payloads that the local machine produces.
 *
 * Flow: `pnpm sync` (locally) → builds data/snapshot.json → uploads to Vercel
 * Blob → the public Blob URL is configured as SNAPSHOT_URL on Vercel. API
 * routes that find no local DB call loadSnapshot() and serve the baked data.
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

const TTL_MS = 5 * 60 * 1000;

let cached: Snapshot | null = null;
let cachedAt = 0;
let lastError: string | null = null;

/** Why the snapshot is unavailable — surfaced in API meta for debugging. */
export function getSnapshotStatus(): { urlConfigured: boolean; lastError: string | null } {
  return { urlConfigured: !!process.env.SNAPSHOT_URL, lastError };
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
    const url = process.env.SNAPSHOT_URL;
    if (url) {
      const res = await fetch(url, { next: { revalidate: 300 } });
      if (res.ok) {
        cached = (await res.json()) as Snapshot;
        cachedAt = Date.now();
        lastError = null;
        return cached;
      }
      lastError = `fetch failed: ${res.status} ${res.statusText}`;
      console.error(`Snapshot fetch failed: ${res.status} ${res.statusText}`);
    } else {
      lastError = "SNAPSHOT_URL not set";
    }

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
