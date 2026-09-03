import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dataAvailable, uiOnlyResponse } from "@/lib/api-helpers";
import { tokens, canonicalAssets, tokenMetricSnapshots, signals } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    if (!dataAvailable()) return uiOnlyResponse("tokens/[address]");

    const { address } = await params;
    const db = getDb();
    const normalizedAddress = address.toLowerCase();

    // Fetch token
    const tokenList = await db
      .select()
      .from(tokens)
      .where(eq(tokens.address, normalizedAddress))
      .limit(1);

    if (tokenList.length === 0) {
      return NextResponse.json(
        { error: "Token not found", data: null },
        { status: 404 }
      );
    }

    const token = tokenList[0];

    // Fetch canonical asset if linked
    let canonicalAsset = null;
    if (token.canonicalAssetId) {
      const caList = await db
        .select()
        .from(canonicalAssets)
        .where(eq(canonicalAssets.id, token.canonicalAssetId))
        .limit(1);
      canonicalAsset = caList[0] || null;
    }

    // Fetch latest metrics
    const metricsList = await db
      .select()
      .from(tokenMetricSnapshots)
      .where(
        and(
          eq(tokenMetricSnapshots.tokenAddress, normalizedAddress),
          eq(tokenMetricSnapshots.window, "24h")
        )
      )
      .orderBy(desc(tokenMetricSnapshots.calculatedAt))
      .limit(1);

    const metric = metricsList[0] || null;

    // Fetch active signals
    const signalList = await db
      .select()
      .from(signals)
      .where(
        and(
          eq(signals.entityId, normalizedAddress),
          eq(signals.status, "ACTIVE")
        )
      )
      .orderBy(desc(signals.adjustedScore))
      .limit(10);

    return NextResponse.json({
      data: {
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
        isVerified: token.isVerified,
        metrics: metric ? {
          holderCount: metric.holderCount,
          holderDelta: metric.holderDelta,
          uniqueBuyers: metric.uniqueBuyers,
          uniqueSellers: metric.uniqueSellers,
          netFlowUsd: metric.netFlowUsd,
          liquidityUsd: metric.liquidityUsd,
          depth1pctUsd: metric.depth1pctUsd,
          volumeUsd: metric.volumeUsd,
          top10Share: metric.top10Share,
          dataCompleteness: metric.dataCompleteness,
        } : null,
        signals: signalList.map((s) => ({
          id: s.id,
          type: s.signalType,
          rawScore: s.rawScore ? Number(s.rawScore) : 0,
          riskScore: s.riskScore ? Number(s.riskScore) : 0,
          adjustedScore: s.adjustedScore ? Number(s.adjustedScore) : 0,
          confidence: s.confidence || "LOW",
        })),
      },
      meta: {
        lastUpdatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Failed to fetch token detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch token", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
