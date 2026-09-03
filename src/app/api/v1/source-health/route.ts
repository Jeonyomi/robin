import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sourceSyncState } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    // Get all sync states
    const syncStates = await db
      .select()
      .from(sourceSyncState)
      .orderBy(desc(sourceSyncState.lastSuccessAt));

    // Check Robinhood Assets API health
    let robinhoodAssetsStatus = "unknown";
    try {
      const response = await fetch("https://api.robinhood.com/rhj/assets", {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      robinhoodAssetsStatus = response.ok ? "healthy" : "degraded";
    } catch {
      robinhoodAssetsStatus = "unavailable";
    }

    // Check Blockscout API health
    let blockscoutStatus = "unknown";
    try {
      const response = await fetch("https://api.blockscout.com/4663/api/v2/stats", {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      blockscoutStatus = response.ok ? "healthy" : "degraded";
    } catch {
      blockscoutStatus = "unavailable";
    }

    return NextResponse.json({
      data: {
        sources: [
          {
            name: "Robinhood Assets API",
            url: "https://api.robinhood.com/rhj/assets",
            status: robinhoodAssetsStatus,
            lastSuccessAt: syncStates.find((s) => s.source === "robinhood" && s.jobName === "assets")?.lastSuccessAt?.toISOString() || null,
            lastError: syncStates.find((s) => s.source === "robinhood" && s.jobName === "assets")?.lastError || null,
          },
          {
            name: "Blockscout API",
            url: "https://api.blockscout.com/4663/api/v2",
            status: blockscoutStatus,
            lastSuccessAt: syncStates.find((s) => s.source === "blockscout")?.lastSuccessAt?.toISOString() || null,
            lastError: syncStates.find((s) => s.source === "blockscout")?.lastError || null,
          },
          {
            name: "Database",
            url: "Neon Postgres",
            status: "healthy",
            lastSuccessAt: new Date().toISOString(),
            lastError: null,
          },
        ],
        overallStatus: robinhoodAssetsStatus === "healthy" && blockscoutStatus === "healthy" ? "healthy" : "degraded",
      },
      meta: {
        checkedAt: new Date().toISOString(),
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
