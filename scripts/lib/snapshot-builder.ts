/**
 * Shared snapshot build + publish logic (local-only; imports @vercel/blob).
 * Used by scripts/build-snapshot.ts, scripts/publish-snapshot.ts and the
 * optional auto-publish step inside scripts/sync.ts.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";
import { getDb } from "@/lib/db";
import { tokens } from "@/db/schema";
import {
  WINDOWS,
  getOverviewData,
  getStockTokensData,
  getTokenDetailData,
  getTokensScannerData,
  getSyncStatesData,
} from "@/lib/queries";
import type { OverviewData, StockTokenRow } from "@/lib/queries";
import type { Snapshot } from "@/lib/snapshot";

/** Re-run every read query against Neon Postgres and collect payloads. */
export async function buildSnapshot(): Promise<Snapshot> {
  const db = getDb();

  const overview = {} as Record<string, OverviewData>;
  for (const w of WINDOWS) {
    overview[w] = await getOverviewData(db, w);
  }

  const stockTokens = {} as Record<string, StockTokenRow[]>;
  for (const w of WINDOWS) {
    stockTokens[w] = await getStockTokensData(db, w, false);
  }

  const tokenList = await db.select().from(tokens);
  const tokenDetails = {} as Snapshot["tokenDetails"];
  for (const t of tokenList) {
    const detail = await getTokenDetailData(db, t.address);
    if (detail) tokenDetails[t.address] = detail;
  }

  const tokensScanner = await getTokensScannerData(db);
  const syncStates = await getSyncStatesData(db);

  return {
    builtAt: new Date().toISOString(),
    overview,
    stockTokens,
    tokenDetails,
    tokensScanner,
    syncStates,
  };
}

/** Persist the snapshot to data/snapshot.json (used for local dev + upload). */
export function writeSnapshot(snapshot: Snapshot): { filePath: string; sizeBytes: number } {
  const filePath = path.join(process.cwd(), "data", "snapshot.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(snapshot));
  return { filePath, sizeBytes: fs.statSync(filePath).size };
}

/** Build + write locally + upload to Vercel Blob. Requires BLOB_READ_WRITE_TOKEN. */
export async function publishSnapshotToBlob(): Promise<{ url: string; sizeBytes: number }> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is not set. Create a Blob store in the Vercel dashboard and add its token to .env."
    );
  }

  const snapshot = await buildSnapshot();
  const { sizeBytes } = writeSnapshot(snapshot);

  const blob = await put("robin/snapshot.json", JSON.stringify(snapshot), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });

  return { url: blob.url, sizeBytes };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
