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
    lastAttemptAt: state?.lastStartedAt ?? null,
    // Stored upstream errors can contain provider URLs or credentials.
    lastError: state?.lastError
      ? "Latest collector attempt failed."
      : state?.lastSuccessAt && !lastSuccessAt
        ? "Stored success timestamp is invalid or in the future."
        : null,
  };
}

function chainStatsHealth(state: SyncStateRow | undefined, now: number) {
  const health = storedHealth(state, now);
  const rejectedRegression = state?.lastError?.startsWith("Ignored regressing Blockscout stats response:") ?? false;
  const acceptedIsFresh = health.lastSuccessAt !== null
    && now - Date.parse(health.lastSuccessAt) <= 3 * 60 * 60 * 1000;
  if (!rejectedRegression || !acceptedIsFresh) return { ...health, warning: null };
  return {
    ...health,
    status: "healthy",
    lastError: null,
    warning: "Latest collector attempt was rejected because the provider aggregate regressed.",
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
    const chainUsesRpc = blockscoutStatsState?.cursor !== null
      && typeof blockscoutStatsState?.cursor === "object"
      && (blockscoutStatsState.cursor as Record<string, unknown>).source === "rpc";
    const gasUsesRpc = gasState?.cursor !== null
      && typeof gasState?.cursor === "object"
      && (gasState.cursor as Record<string, unknown>).source === "rpc";
    const rpcTransferState = findState("rpc", "token-transfers");
    const transferState = findState("blockscout", "token-transfers");
    const databaseStatus = database.ok ? "healthy" : syncStates.length > 0 ? "degraded" : "unavailable";

    const lpSnapshot = lpRead.ok ? lpRead.data : null;
    // Freshness is based on the source block, never publication or attempt time.
    const lpUsable = lpSnapshot !== null && isFreshLeaderboard(lpSnapshot.data, now);
    const lpLastSuccessAt = validSuccessAt(lpSnapshot?.collector.publishedAt, now);
    const lpTimesValid = lpLastSuccessAt !== null && validSuccessAt(lpSnapshot?.collector.lastAttemptAt, now) !== null;
    const lpAttemptFailed = lpSnapshot !== null && (!lpSnapshot.collector.lastAttemptOk || lpSnapshot.collector.lastError !== null);
    // A fresh, verified snapshot remains operational after a transient failed
    // refresh. Preserve the attempt warning without relabeling usable data.
    const lpStatus = !lpSnapshot ? "unavailable" : lpUsable && lpTimesValid ? "healthy" : "degraded";
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
        role: "active" as const,
        url: "https://api.robinhood.com/rhj/assets",
        // This registry is maintained daily; allow normal schedule jitter.
        ...storedHealth(robinhoodState, now, 26),
      },
      {
        name: chainUsesRpc ? "RPC Chain State" : "Blockscout Chain Stats",
        role: "active" as const,
        url: chainUsesRpc ? "Configured chain RPC (chain 4663)" : "https://robinhoodchain.blockscout.com/api/v2/stats",
        ...chainStatsHealth(blockscoutStatsState, now),
      },
      {
        name: gasUsesRpc ? "RPC Gas Price" : "Blockscout Gas Price",
        role: "active" as const,
        url: gasUsesRpc ? "Configured chain RPC (chain 4663)" : "https://robinhoodchain.blockscout.com/api/v2/stats",
        ...storedHealth(gasState, now, 1),
      },
      {
        name: "Legacy Blockscout Token Transfers",
        role: "legacy" as const,
        url: "https://robinhoodchain.blockscout.com/api/v2/tokens/{address}/transfers",
        ...storedHealth(transferState, now),
      },
      {
        name: "RPC Token Transfers",
        role: "active" as const,
        url: "Configured chain RPC (chain 4663)",
        ...storedHealth(rpcTransferState, now),
      },
      {
        name: "Database",
        role: "active" as const,
        url: "Neon Postgres",
        status: databaseStatus,
        lastSuccessAt: database.ok ? database.data.readAt : null,
        lastError: database.ok ? null : database.attempted ? "Database read failed." : "Database is not configured.",
      },
      {
        name: "Uniswap V3 LP Snapshot",
        role: "active" as const,
        url: "/api/v1/lp-leaders",
        status: lpStatus,
        lastSuccessAt: lpLastSuccessAt,
        lastError: lpStatus === "healthy" ? null : lpLastError,
        warning: lpStatus === "healthy" && lpAttemptFailed ? lpLastError : null,
        observedAt: lpSnapshot?.data.observedAt ?? null,
        lastAttemptAt: lpSnapshot?.collector.lastAttemptAt ?? null,
        lastAttemptOk: lpSnapshot?.collector.lastAttemptOk ?? null,
        usable: lpUsable,
        maxSourceAgeSeconds: LP_LEADER_FRESH_MS / 1000,
        servedFrom: lpRead.ok ? "neon-postgres" : "unavailable",
      },
    ];
    const overallStatus = sources
      .filter((source) => source.role === "active")
      .every((source) => source.status === "healthy") ? "healthy" : "degraded";

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
