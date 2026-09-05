import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  invalidWindowResponse,
  parseObservationWindow,
  tryDatabase,
  uiOnlyResponse,
} from "@/lib/api-helpers";
import { getOverviewData } from "@/lib/queries";
import { loadSnapshot, pickWindow } from "@/lib/snapshot";

export async function GET(request: Request) {
  try {
    const window = parseObservationWindow(request);
    if (!window) return invalidWindowResponse();

    const database = await tryDatabase(() => getOverviewData(getDb(), window));
    if (database.ok) {
      return NextResponse.json({
        data: { ...database.data, topTokens: [] },
        meta: {
          window,
          sources: ["blockscout-direct", "robinhood-assets"],
          lastUpdatedAt: database.data.lastUpdatedAt,
          calculationVersion: "observation-v4",
          methodology: "page-bounded-descriptive-observation",
          comparativeRanking: "available-via-activity-lens-gate",
          servedFrom: "neon-postgres",
        },
      });
    }

    const snap = await loadSnapshot();
    const data = snap ? pickWindow(snap.overview, window) : undefined;
    if (data && "activity" in data && "coverage" in data) {
      return NextResponse.json({
        data: { ...data, topTokens: [] },
        meta: {
          window,
          sources: ["blockscout-direct", "robinhood-assets"],
          lastUpdatedAt: snap?.builtAt ?? new Date().toISOString(),
          calculationVersion: "observation-v4",
          methodology: "page-bounded-descriptive-observation",
          comparativeRanking: "available-via-activity-lens-gate",
          servedFrom: "snapshot",
          degraded: database.attempted,
        },
      });
    }
    return uiOnlyResponse("overview");
  } catch (error) {
    console.error("Failed to fetch overview:", error);
    return NextResponse.json({ error: "Failed to fetch overview" }, { status: 500 });
  }
}
