import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { tryDatabase } from "@/lib/api-helpers";
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
    // Sync states come from Neon when healthy, otherwise the last snapshot.
    const database = await tryDatabase(() => getSyncStatesData(getDb()));
    const snapshot = database.ok ? null : await loadSnapshot();
    const syncStates = database.ok ? database.data : snapshot?.syncStates ?? [];

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
          robinhoodAssetsStatus === "healthy" && blockscoutStatus === "healthy" && database.ok
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
