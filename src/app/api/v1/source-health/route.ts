import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { tryDatabase } from "@/lib/api-helpers";
import { getSyncStatesData, type SyncStateRow } from "@/lib/queries";
import { loadSnapshot } from "@/lib/snapshot";

function storedStatus(state: SyncStateRow | undefined, maxAgeHours = 3) {
  if (!state?.lastSuccessAt) return "unknown";
  if (state.lastError) return "degraded";
  const ageMs = Date.now() - Date.parse(state.lastSuccessAt);
  return Number.isFinite(ageMs) && ageMs <= maxAgeHours * 60 * 60 * 1000
    ? "healthy"
    : "degraded";
}

export async function GET() {
  try {
    // Read persisted collector outcomes only. Public requests must not fan out
    // into live upstream probes of Robinhood or Blockscout.
    const database = await tryDatabase(() => getSyncStatesData(getDb()));
    const snapshot = database.ok ? null : await loadSnapshot();
    const syncStates = database.ok ? database.data : snapshot?.syncStates ?? [];

    const findState = (source: string, jobName: string) =>
      syncStates.find((state) => state.source === source && state.jobName === jobName);

    const robinhoodState = findState("robinhood", "canonical-assets");
    const blockscoutStatsState = findState("blockscout", "chain-stats");
    const transferState = findState("blockscout", "token-transfers");
    const robinhoodStatus = storedStatus(robinhoodState);
    const statsStatus = storedStatus(blockscoutStatsState);
    const transferStatus = storedStatus(transferState);
    const databaseStatus = database.ok ? "healthy" : syncStates.length > 0 ? "degraded" : "unavailable";

    const sources = [
      {
        name: "Robinhood Assets API",
        url: "https://api.robinhood.com/rhj/assets",
        status: robinhoodStatus,
        lastSuccessAt: robinhoodState?.lastSuccessAt || null,
        lastError: robinhoodState?.lastError || null,
      },
      {
        name: "Blockscout Chain Stats",
        url: "https://robinhoodchain.blockscout.com/api/v2/stats",
        status: statsStatus,
        lastSuccessAt: blockscoutStatsState?.lastSuccessAt || null,
        lastError: blockscoutStatsState?.lastError || null,
      },
      {
        name: "Blockscout Token Transfers",
        url: "https://robinhoodchain.blockscout.com/api/v2/tokens/{address}/transfers",
        status: transferStatus,
        lastSuccessAt: transferState?.lastSuccessAt || null,
        lastError: transferState?.lastError || null,
      },
      {
        name: "Database",
        url: database.ok ? "Neon Postgres" : "Snapshot (Vercel Blob)",
        status: databaseStatus,
        lastSuccessAt: syncStates[0]?.lastSuccessAt || null,
        lastError: null,
      },
    ];

    return NextResponse.json({
      data: {
        sources,
        overallStatus:
          robinhoodStatus === "healthy" && statsStatus === "healthy" &&
          transferStatus === "healthy" && databaseStatus === "healthy"
            ? "healthy"
            : "degraded",
      },
      meta: {
        readAt: new Date().toISOString(),
        liveProbes: false,
        source: "persisted-collector-state",
        servedFrom: database.ok ? "neon-postgres" : "snapshot",
        degraded: !database.ok && database.attempted,
      },
    });
  } catch (error) {
    console.error("Failed to read source health:", error);
    return NextResponse.json({ error: "Failed to read source health" }, { status: 500 });
  }
}
