import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { tryDatabase } from "@/lib/api-helpers";
import { getSyncStatesData } from "@/lib/queries";
import { loadSnapshot } from "@/lib/snapshot";

async function checkUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok ? "healthy" : "degraded";
  } catch {
    return "unavailable";
  }
}

export async function GET() {
  try {
    // Sync states come from Neon when healthy, otherwise the last snapshot.
    const database = await tryDatabase(() => getSyncStatesData(getDb()));
    const snapshot = database.ok ? null : await loadSnapshot();
    const syncStates = database.ok ? database.data : snapshot?.syncStates ?? [];

    const findState = (source: string, jobName?: string) =>
      syncStates.find((s) => s.source === source && (!jobName || s.jobName === jobName));

    const [robinhoodAssetsStatus, blockscoutStatus] = await Promise.all([
      checkUrl("https://api.robinhood.com/rhj/assets"),
      checkUrl("https://robinhoodchain.blockscout.com/api/v2/stats"),
    ]);

    const robinhoodState = findState("robinhood", "canonical-assets");
    const blockscoutStatsState = findState("blockscout", "chain-stats");
    const transferState = findState("blockscout", "token-transfers");

    const sources = [
      {
        name: "Robinhood Assets API",
        url: "https://api.robinhood.com/rhj/assets",
        status: robinhoodAssetsStatus,
        lastSuccessAt: robinhoodState?.lastSuccessAt || null,
        lastError: robinhoodState?.lastError || null,
      },
      {
        name: "Blockscout Chain Stats",
        url: "https://robinhoodchain.blockscout.com/api/v2/stats",
        status: blockscoutStatus,
        lastSuccessAt: blockscoutStatsState?.lastSuccessAt || null,
        lastError: blockscoutStatsState?.lastError || null,
      },
      {
        name: "Blockscout Token Transfers",
        url: "https://robinhoodchain.blockscout.com/api/v2/tokens/{address}/transfers",
        status: transferState?.lastSuccessAt ? transferState.lastError ? "degraded" : "healthy" : "unknown",
        lastSuccessAt: transferState?.lastSuccessAt || null,
        lastError: transferState?.lastError || null,
      },
      {
        name: "Database",
        url: database.ok ? "Neon Postgres" : "Snapshot (Vercel Blob)",
        status: database.ok ? "healthy" : syncStates.length > 0 ? "degraded" : "unavailable",
        lastSuccessAt: syncStates[0]?.lastSuccessAt || null,
        lastError: null,
      },
    ];

    return NextResponse.json({
      data: {
        sources,
        overallStatus:
          robinhoodAssetsStatus === "healthy" && blockscoutStatus === "healthy" &&
          Boolean(transferState?.lastSuccessAt) && !transferState?.lastError && database.ok
            ? "healthy"
            : "degraded",
      },
      meta: {
        checkedAt: new Date().toISOString(),
        servedFrom: database.ok ? "neon-postgres" : "snapshot",
        degraded: !database.ok && database.attempted,
      },
    });
  } catch (error) {
    console.error("Failed to check source health:", error);
    return NextResponse.json(
      { error: "Failed to check source health" },
      { status: 500 }
    );
  }
}
