import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dataAvailable, uiOnlyResponse } from "@/lib/api-helpers";
import { tokens, tokenTransfers, signals, sourceSyncState, economicActions } from "@/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    if (!dataAvailable()) return uiOnlyResponse("overview");

    const { searchParams } = new URL(request.url);
    const window = searchParams.get("window") || "24h";

    // Calculate time window
    const now = new Date();
    const windowHours = window === "1h" ? 1 : window === "6h" ? 6 : window === "24h" ? 24 : 168;
    const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

    const db = getDb();

    // Token count
    const tokenCount = await db.select({ count: sql<number>`count(*)` }).from(tokens);

    // Transfer count in window (proxy for active wallets)
    const transferCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(tokenTransfers)
      .where(gte(tokenTransfers.timestamp, windowStart));

    // Signal counts
    const signalCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(signals)
      .where(gte(signals.createdAt, windowStart));

    const highRiskCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(signals)
      .where(and(gte(signals.createdAt, windowStart), eq(signals.status, "ACTIVE")));

    // Economic action volume in window (real DEX volume when data exists)
    const volumeRow = await db
      .select({ total: sql<number>`COALESCE(SUM(usd_value), 0)` })
      .from(economicActions)
      .where(and(gte(economicActions.timestamp, windowStart), eq(economicActions.actionType, "SWAP")));

    // Capital flow timeline from economic actions (bridge + swap grouped hourly).
    // SQLite stores timestamps as unix ms (integer), so bucket with strftime.
    const hourExpr = sql<string>`strftime('%Y-%m-%dT%H:00:00.000Z', timestamp / 1000, 'unixepoch')`;
    const timelineRows = await db
      .select({
        hour: hourExpr,
        bridgeIn: sql<number>`COALESCE(SUM(CASE WHEN action_type = 'BRIDGE_IN' THEN usd_value ELSE 0 END), 0)`,
        bridgeOut: sql<number>`COALESCE(SUM(CASE WHEN action_type = 'BRIDGE_OUT' THEN usd_value ELSE 0 END), 0)`,
        dexBuy: sql<number>`COALESCE(SUM(CASE WHEN action_type = 'SWAP' AND usd_value >= 0 THEN usd_value ELSE 0 END), 0)`,
        dexSell: sql<number>`COALESCE(SUM(CASE WHEN action_type = 'SWAP' AND usd_value < 0 THEN ABS(usd_value) ELSE 0 END), 0)`,
      })
      .from(economicActions)
      .where(gte(economicActions.timestamp, windowStart))
      .groupBy(hourExpr)
      .orderBy(hourExpr);

    const timeline = timelineRows.map((r) => ({
      timestamp: r.hour,
      bridgeIn: Number(r.bridgeIn) || 0,
      bridgeOut: Number(r.bridgeOut) || 0,
      dexBuy: Number(r.dexBuy) || 0,
      dexSell: Number(r.dexSell) || 0,
    }));

    // Activity composition by action type
    const compositionRows = await db
      .select({ type: economicActions.actionType, total: sql<number>`COALESCE(SUM(usd_value), 0)` })
      .from(economicActions)
      .where(gte(economicActions.timestamp, windowStart))
      .groupBy(economicActions.actionType);

    const composition = compositionRows.map((r) => ({
      name: r.type.replace(/_/g, " "),
      value: Number(r.total) || 0,
    }));

    // Last sync state
    const lastSync = await db
      .select()
      .from(sourceSyncState)
      .orderBy(sql`last_success_at DESC NULLS LAST`)
      .limit(1);

    const dexVolume = Number(volumeRow[0]?.total) || 0;

    return NextResponse.json({
      data: {
        netCapitalInflow24h: timeline.reduce((acc, t) => acc + (t.bridgeIn - t.bridgeOut), 0),
        activeWallets24h: transferCount[0]?.count || 0,
        dexVolume24h: dexVolume,
        usdgNetFlow24h: 0, // Requires USDG address tracking — populated after token sync
        signals24h: signalCount[0]?.count || 0,
        highRiskAlerts: highRiskCount[0]?.count || 0,
        tokenCount: tokenCount[0]?.count || 0,
        lastUpdatedAt: lastSync[0]?.lastSuccessAt?.toISOString() || new Date().toISOString(),
        timeline,
        composition,
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
