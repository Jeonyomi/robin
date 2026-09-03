import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { tokens, canonicalAssets, tokenMetricSnapshots } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const window = searchParams.get("window") || "24h";
    const canonicalOnly = searchParams.get("canonicalOnly") === "true";

    // Fetch canonical assets
    const db = getDb();
    const canonical = await db.select().from(canonicalAssets);

    // Fetch tokens with canonical status
    const tokenQuery = canonicalOnly
      ? db.select().from(tokens).where(eq(tokens.canonicalStatus, "CANONICAL"))
      : db.select().from(tokens);

    const tokenList = await tokenQuery;

    // Enrich with latest metrics
    const enriched = await Promise.all(
      tokenList.map(async (token) => {
        const metrics = await db
          .select()
          .from(tokenMetricSnapshots)
          .where(
            and(
              eq(tokenMetricSnapshots.tokenAddress, token.address),
              eq(tokenMetricSnapshots.window, window)
            )
          )
          .orderBy(desc(tokenMetricSnapshots.calculatedAt))
          .limit(1);

        const latestMetric = metrics[0] || null;

        // Find matching canonical asset
        const canonicalAsset = canonical.find(
          (a) => a.contractAddress.toLowerCase() === token.address.toLowerCase()
        );

        return {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          canonicalStatus: token.canonicalStatus,
          canonicalAsset: canonicalAsset ? {
            id: canonicalAsset.id,
            symbol: canonicalAsset.symbol,
            multiplier: canonicalAsset.currentMultiplier,
            status: canonicalAsset.assetStatus,
          } : null,
          metrics: latestMetric ? {
            holderCount: latestMetric.holderCount,
            holderDelta: latestMetric.holderDelta,
            uniqueBuyers: latestMetric.uniqueBuyers,
            uniqueSellers: latestMetric.uniqueSellers,
            netFlowUsd: latestMetric.netFlowUsd,
            liquidityUsd: latestMetric.liquidityUsd,
            depth1pctUsd: latestMetric.depth1pctUsd,
            volumeUsd: latestMetric.volumeUsd,
            top10Share: latestMetric.top10Share,
            dataCompleteness: latestMetric.dataCompleteness,
          } : null,
          lastSeenAt: token.lastSeenAt,
        };
      })
    );

    return NextResponse.json({
      data: enriched,
      meta: {
        window,
        canonicalOnly,
        lastUpdatedAt: new Date().toISOString(),
        sources: ["blockscout", "robinhood"],
      },
    });
  } catch (error) {
    console.error("Failed to fetch stock tokens:", error);
    return NextResponse.json(
      { error: "Failed to fetch stock tokens", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
