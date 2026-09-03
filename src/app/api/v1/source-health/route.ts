import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dataAvailable } from "@/lib/api-helpers";
import { getSyncStatesData } from "@/lib/queries";
import { loadSnapshot } from "@/lib/snapshot";

async function checkUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return response.ok ? "healthy" : "degraded";
  } catch {
    return "unavailable";
  }
}

export async function GET() {
  try {
    // Sync states come from the local DB when present, otherwise the snapshot
    const syncStates = dataAvailable()
      ? await getSyncStatesData(getDb())
      : (await loadSnapshot())?.syncStates ?? [];

    const findState = (source: string, jobName?: string) =>
      syncStates.find((s) => s.source === source && (!jobName || s.jobName === jobName));

    const robinhoodAssetsStatus = await checkUrl("https://api.robinhood.com/rhj/assets");
    const blockscoutStatus = await checkUrl("https://api.blockscout.com/4663/api/v2/stats");

    const robinhoodState = findState("robinhood", "assets");
    const blockscoutState = findState("blockscout");

    const sources = [
      {
        name: "Robinhood Assets API",
        url: "https://api.robinhood.com/rhj/assets",
        status: robinhoodAssetsStatus,
        lastSuccessAt: robinhoodState?.lastSuccessAt || null,
        lastError: robinhoodState?.lastError || null,
      },
      {
        name: "Blockscout API",
        url: "https://api.blockscout.com/4663/api/v2",
        status: blockscoutStatus,
        lastSuccessAt: blockscoutState?.lastSuccessAt || null,
        lastError: blockscoutState?.lastError || null,
      },
      {
        name: "Database",
        url: dataAvailable() ? "SQLite (local)" : "Snapshot (Vercel Blob)",
        status: dataAvailable() || syncStates.length > 0 ? "healthy" : "unavailable",
        lastSuccessAt: syncStates[0]?.lastSuccessAt || null,
        lastError: null,
      },
    ];

    return NextResponse.json({
      data: {
        sources,
        overallStatus:
          robinhoodAssetsStatus === "healthy" && blockscoutStatus === "healthy"
            ? "healthy"
            : "degraded",
      },
      meta: {
        checkedAt: new Date().toISOString(),
        servedFrom: dataAvailable() ? "local-db" : "snapshot",
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
