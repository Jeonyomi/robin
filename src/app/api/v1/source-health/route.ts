import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { tryDatabase } from "@/lib/api-helpers";
import { getSyncStatesData, type SyncStateRow } from "@/lib/queries";
import { loadSnapshot } from "@/lib/snapshot";
import { isFreshLeaderboard, LP_LEADER_FRESH_MS } from "@/lib/lp-leaders";
import { readStoredLpSnapshot } from "@/lib/sources/uniswap-v3/snapshot-store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };

function validSuccessAt(value: string | null | undefined, now: number) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now ? value : null;
}

function storedHealth(state: SyncStateRow | undefined, now: number, maxAgeHours = 3) {
  const lastSuccessAt = validSuccessAt(state?.lastSuccessAt, now);
  const fresh = lastSuccessAt !== null && now - Date.parse(lastSuccessAt) <= maxAgeHours * 60 * 60 * 1000;
  return {
    // A failed first attempt is degraded, not an unobserved/unknown source.
    status: state?.lastError ? "degraded" : !state?.lastSuccessAt ? "unknown" : fresh ? "healthy" : "degraded",
    lastSuccessAt,
    // Stored upstream errors can contain provider URLs or credentials.
    lastError: state?.lastError
      ? "Latest collector attempt failed."
      : state?.lastSuccessAt && !lastSuccessAt
        ? "Stored success timestamp is invalid or in the future."
        : null,
  };
}

export async function GET() {
  try {
    // Read persisted collector outcomes only. Public requests must not fan out
    // into live upstream probes, RPC calls, or collector runs.
    const [database, lpRead] = await Promise.all([
      tryDatabase(async () => ({
        syncStates: await getSyncStatesData(getDb()),
        // This is evidence of a database read, not a collector's success time.
        readAt: new Date().toISOString(),
      })),
      readStoredLpSnapshot().then(
        (data) => ({ ok: true as const, data }),
        () => ({ ok: false as const }),
      ),
    ]);
    const snapshot = database.ok ? null : await loadSnapshot();
    const syncStates = database.ok ? database.data.syncStates : snapshot?.syncStates ?? [];
    const now = Date.now();

    const findState = (source: string, jobName: string) =>
      syncStates.find((state) => state.source === source && state.jobName === jobName);

    const robinhoodState = findState("robinhood", "canonical-assets");
    const blockscoutStatsState = findState("blockscout", "chain-stats");
    const gasState = findState("blockscout", "gas-prices");
    const transferState = findState("blockscout", "token-transfers");
    const databaseStatus = database.ok ? "healthy" : syncStates.length > 0 ? "degraded" : "unavailable";

    const lpSnapshot = lpRead.ok ? lpRead.data : null;
    // Freshness is based on the source block, never publication or attempt time.
    const lpUsable = lpSnapshot !== null && isFreshLeaderboard(lpSnapshot.data, now);
    const lpLastSuccessAt = validSuccessAt(lpSnapshot?.collector.publishedAt, now);
    const lpTimesValid = lpLastSuccessAt !== null && validSuccessAt(lpSnapshot?.collector.lastAttemptAt, now) !== null;
    const lpAttemptFailed = lpSnapshot !== null && (!lpSnapshot.collector.lastAttemptOk || lpSnapshot.collector.lastError !== null);
    const lpStatus = !lpSnapshot ? "unavailable" : lpUsable && lpTimesValid && !lpAttemptFailed ? "healthy" : "degraded";
    const lpLastError = !lpRead.ok
      ? "Stored LP snapshot could not be read."
      : !lpSnapshot
        // The store returns null for both missing and failure-only rows.
        ? "No published LP snapshot is available."
        : lpAttemptFailed
          // lastError is an allowlisted code validated by the snapshot store.
          ? `Latest LP collector attempt failed (${lpSnapshot.collector.lastError ?? "other"}).`
          : !lpTimesValid
            ? "Stored LP collector timestamp is invalid or in the future."
            : !lpUsable
              ? "Stored LP observation is stale or has an invalid timestamp."
              : null;

    const sources = [
      {
        name: "Robinhood Assets API",
        url: "https://api.robinhood.com/rhj/assets",
        ...storedHealth(robinhoodState, now),
      },
      {
        name: "Blockscout Chain Stats",
        url: "https://robinhoodchain.blockscout.com/api/v2/stats",
        ...storedHealth(blockscoutStatsState, now),
      },
      {
        name: "Blockscout Gas Price",
        url: "https://robinhoodchain.blockscout.com/api/v2/stats",
        ...storedHealth(gasState, now, 1),
      },
      {
        name: "Blockscout Token Transfers",
        url: "https://robinhoodchain.blockscout.com/api/v2/tokens/{address}/transfers",
        ...storedHealth(transferState, now),
      },
      {
        name: "Database",
        url: "Neon Postgres",
        status: databaseStatus,
        lastSuccessAt: database.ok ? database.data.readAt : null,
        lastError: database.ok ? null : database.attempted ? "Database read failed." : "Database is not configured.",
      },
      {
        name: "Uniswap V3 LP Snapshot",
        url: "/api/v1/lp-leaders",
        status: lpStatus,
        lastSuccessAt: lpLastSuccessAt,
        lastError: lpLastError,
        observedAt: lpSnapshot?.data.observedAt ?? null,
        lastAttemptAt: lpSnapshot?.collector.lastAttemptAt ?? null,
        lastAttemptOk: lpSnapshot?.collector.lastAttemptOk ?? null,
        usable: lpUsable,
        maxSourceAgeSeconds: LP_LEADER_FRESH_MS / 1000,
        servedFrom: lpRead.ok ? "neon-postgres" : "unavailable",
      },
    ];
    const overallStatus = sources.every((source) => source.status === "healthy") ? "healthy" : "degraded";

    return NextResponse.json({
      data: {
        sources,
        overallStatus,
      },
      meta: {
        readAt: new Date(now).toISOString(),
        liveProbes: false,
        source: "persisted-collector-state",
        // Legacy sync-state provenance; the LP entry reports its own storage.
        servedFrom: database.ok ? "neon-postgres" : snapshot ? "snapshot" : "unavailable",
        degraded: overallStatus !== "healthy",
      },
    }, { headers });
  } catch {
    console.error("Failed to read source health");
    return NextResponse.json({ error: "Failed to read source health" }, { status: 500, headers });
  }
}
