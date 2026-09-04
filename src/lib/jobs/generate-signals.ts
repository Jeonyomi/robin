import { getDb } from "@/lib/db";
import { tokens, tokenMetricSnapshots, signals, sourceSyncState } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

/**
 * Job 5b — Generate risk and opportunity signals from metric snapshots.
 */
export async function generateSignals(): Promise<{
  processed: number;
  created: number;
}> {
  const db = getDb();

  await db
    .insert(sourceSyncState)
    .values({
      source: "internal",
      jobName: "signals",
      lastStartedAt: new Date(),
      status: "running",
    })
    .onConflictDoUpdate({
      target: [sourceSyncState.source, sourceSyncState.jobName],        set: { lastStartedAt: new Date(), status: "running" },
    });

  let created = 0;

  try {
    const tokenList = await db
      .select()
      .from(tokens)
      .where(eq(tokens.canonicalStatus, "CANONICAL"));

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    for (const token of tokenList.slice(0, 50)) {
      const snapshots = await db
        .select()
        .from(tokenMetricSnapshots)
        .where(
          and(
            eq(tokenMetricSnapshots.tokenAddress, token.address),
            eq(tokenMetricSnapshots.window, "24h")
          )
        )
        .orderBy(desc(tokenMetricSnapshots.calculatedAt))
        .limit(1);

      const snapshot = snapshots[0];
      if (!snapshot) continue;

      const recentCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(signals)
        .where(
          and(
            eq(signals.entityId, token.address),
            eq(signals.entityType, "TOKEN")
          )
        );

      if (recentCount[0] && Number(recentCount[0].count) > 0) continue;

      let riskScore = 0;
      if (snapshot.top10Share && snapshot.top10Share > 0.7) riskScore += 30;
      else if (snapshot.top10Share && snapshot.top10Share > 0.5) riskScore += 15;
      if (snapshot.holderCount && snapshot.holderCount < 100) riskScore += 25;
      else if (snapshot.holderCount && snapshot.holderCount < 500) riskScore += 10;
      if (snapshot.dataCompleteness && snapshot.dataCompleteness < 0.5) riskScore += 20;
      else if (snapshot.dataCompleteness && snapshot.dataCompleteness < 0.7) riskScore += 10;

      let opportunityScore = 0;
      if (snapshot.volumeUsd && snapshot.volumeUsd > 100000) opportunityScore += 25;
      else if (snapshot.volumeUsd && snapshot.volumeUsd > 10000) opportunityScore += 10;
      if (snapshot.holderCount && snapshot.holderCount > 1000) opportunityScore += 20;
      else if (snapshot.holderCount && snapshot.holderCount > 500) opportunityScore += 10;
      if (snapshot.holderDelta && snapshot.holderDelta > 0) opportunityScore += 15;
      if (snapshot.liquidityUsd && snapshot.liquidityUsd > 50000) opportunityScore += 15;
      else if (snapshot.liquidityUsd && snapshot.liquidityUsd > 10000) opportunityScore += 5;

      let confidence: string;
      if (snapshot.dataCompleteness && snapshot.dataCompleteness >= 0.8) confidence = "HIGH";
      else if (snapshot.dataCompleteness && snapshot.dataCompleteness >= 0.5) confidence = "MEDIUM";
      else confidence = "LOW";

      const riskSignalId = `risk-${token.address}-${now}`;
      await db.insert(signals).values({
        id: riskSignalId,
        entityType: "TOKEN",
        entityId: token.address,
        signalType: "RISK",
        rawScore: riskScore,
        riskScore: riskScore,
        adjustedScore: riskScore,
        confidence,
        dataCompleteness: snapshot.dataCompleteness || 0,
        evidence: { top10Share: snapshot.top10Share, holderCount: snapshot.holderCount },
        riskFlags: riskScore > 50 ? ["HIGH_RISK"] : riskScore > 25 ? ["MODERATE_RISK"] : [],
        windowStart: new Date(oneDayAgo),
        windowEnd: new Date(now),
        status: "ACTIVE",
      });
      created++;

      const oppSignalId = `opp-${token.address}-${now}`;
      await db.insert(signals).values({
        id: oppSignalId,
        entityType: "TOKEN",
        entityId: token.address,
        signalType: "OPPORTUNITY",
        rawScore: opportunityScore,
        riskScore: riskScore,
        adjustedScore: Math.max(0, opportunityScore - riskScore * 0.3),
        confidence,
        dataCompleteness: snapshot.dataCompleteness || 0,
        evidence: { volumeUsd: snapshot.volumeUsd, holderCount: snapshot.holderCount },
        windowStart: new Date(oneDayAgo),
        windowEnd: new Date(now),
        status: "ACTIVE",
      });
      created++;
    }

    await db
      .update(sourceSyncState)
      .set({
        lastSuccessAt: new Date(),
        status: "success",
        recordsProcessed: created,
        lastError: null,
      })
      .where(
        and(
          eq(sourceSyncState.source, "internal"),
          eq(sourceSyncState.jobName, "signals")
        )
      );

    return { processed: tokenList.length, created };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(sourceSyncState)
      .set({
        lastErrorAt: new Date(),
        lastError: msg,
        status: "error",
      })
      .where(
        and(
          eq(sourceSyncState.source, "internal"),
          eq(sourceSyncState.jobName, "signals")
        )
      );
    throw error;
  }
}
