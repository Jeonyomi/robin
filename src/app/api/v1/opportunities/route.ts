import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  invalidWindowResponse,
  parseObservationWindow,
  tryDatabase,
  uiOnlyResponse,
} from "@/lib/api-helpers";
import { evaluateActivityLensRelease } from "@/lib/domain/activity";
import { getOverviewData, type OverviewData } from "@/lib/queries";
import { loadSnapshot, pickWindow } from "@/lib/snapshot";

function activityLensResponse(
  data: OverviewData,
  window: string,
  servedFrom: "neon-postgres" | "snapshot",
  degraded = false,
) {
  const release = evaluateActivityLensRelease({
    completedCycles: data.coverage.completedCycles,
    trackedTokens: data.coverage.trackedTokens,
    tokensWithStoredTransfers: data.coverage.tokensWithStoredTransfers,
    syncStatus: data.coverage.status,
    lastIndexedAt: data.coverage.lastIndexedAt,
    rankedTokens: data.topTokens.length,
  });

  return NextResponse.json({
    data: release.active ? data.topTokens : [],
    meta: {
      window,
      status: release.status,
      release,
      lastUpdatedAt: data.lastUpdatedAt,
      sources: ["blockscout-direct", "robinhood-assets"],
      methodology: "60% relative observed transfer events + 40% relative observed unique addresses",
      observationBoundary: "Page-bounded rotating sample; values may be lower bounds and are not exhaustive.",
      meaning: "Descriptive onchain activity only; not a price forecast, trade signal, or investment recommendation.",
      investmentRecommendation: false,
      servedFrom,
      ...(degraded ? { degraded: true } : {}),
    },
  });
}

export async function GET(request: Request) {
  try {
    const window = parseObservationWindow(request);
    if (!window) return invalidWindowResponse();

    const database = await tryDatabase(() => getOverviewData(getDb(), window));
    if (database.ok) return activityLensResponse(database.data, window, "neon-postgres");

    const snapshot = await loadSnapshot();
    const data = snapshot ? pickWindow(snapshot.overview, window) : undefined;
    if (data && "activity" in data && "coverage" in data) {
      return activityLensResponse(data, window, "snapshot", database.attempted);
    }

    return uiOnlyResponse("opportunities");
  } catch (error) {
    console.error("Failed to fetch Activity Lens:", error);
    return NextResponse.json({ error: "Failed to fetch Activity Lens" }, { status: 500 });
  }
}
