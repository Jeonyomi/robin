#!/usr/bin/env tsx
import "dotenv/config";
import { desc, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  canonicalAssets,
  economicActions,
  signals,
  sourceSyncState,
  tokenTransfers,
  tokens,
} from "@/db/schema";

async function count(table: typeof tokens | typeof canonicalAssets | typeof tokenTransfers | typeof economicActions | typeof signals) {
  const rows = await getDb().select({ count: sql<number>`count(*)` }).from(table);
  return Number(rows[0]?.count ?? 0);
}

async function main() {
  const db = getDb();
  const latestSync = await db
    .select({
      source: sourceSyncState.source,
      jobName: sourceSyncState.jobName,
      status: sourceSyncState.status,
      lastSuccessAt: sourceSyncState.lastSuccessAt,
      lastError: sourceSyncState.lastError,
    })
    .from(sourceSyncState)
    .orderBy(desc(sourceSyncState.lastSuccessAt))
    .limit(1);

  const result = {
    ok: true,
    provider: "neon-postgres",
    counts: {
      canonicalAssets: await count(canonicalAssets),
      tokens: await count(tokens),
      tokenTransfers: await count(tokenTransfers),
      economicActions: await count(economicActions),
      signals: await count(signals),
    },
    latestSync: latestSync[0] ?? null,
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("Database check failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
