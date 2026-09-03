import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tokens, tokenTransfers, signals, sourceSyncState } from "@/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const window = searchParams.get("window") || "24h";

    // Calculate time window
    const now = new Date();
    const windowHours = window === "1h" ? 1 : window === "6h" ? 6 : window === "24h" ? 24 : 168;
    const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

    // Get token count
    const tokenCount = await db.select({ count: sql<number>`count(*)` }).from(tokens);

    // Get transfer count in window
    const transferCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(tokenTransfers)
      .where(gte(tokenTransfers.timestamp, windowStart));

    // Get signal count in window
    const signalCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(signals)
      .where(gte(signals.createdAt, windowStart));

    // Get high risk signals
    const highRiskCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(signals)
      .where(
        and(
          gte(signals.createdAt, windowStart),
          eq(signals.status, "ACTIVE")
        )
      );

    // Get last sync state
    const lastSync = await db
      .select()
      .from(sourceSyncState)
      .orderBy(sql`last_success_at DESC NULLS LAST`)
      .limit(1);

    return NextResponse.json({
      data: {
        netCapitalInflow24h: 0, // TODO: Calculate from economic_actions
        activeWallets24h: transferCount[0]?.count || 0,
        dexVolume24h: 0, // TODO: Calculate from economic_actions
        usdgNetFlow24h: 0, // TODO: Calculate from token_transfers
        signals24h: signalCount[0]?.count || 0,
        highRiskAlerts: highRiskCount[0]?.count || 0,
        tokenCount: tokenCount[0]?.count || 0,
        lastUpdatedAt: lastSync[0]?.lastSuccessAt?.toISOString() || new Date().toISOString(),
      },
      meta: {
        window,
        sources: ["blockscout", "robinhood"],
        lastUpdatedAt: new Date().toISOString(),
        calculationVersion: "v1",
      },
    });
  } catch (error) {
    console.error("Failed to fetch overview:", error);
    return NextResponse.json(
      { error: "Failed to fetch overview", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
