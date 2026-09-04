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
        data: database.data,
        meta: {
          window,
          lastUpdatedAt: database.data.lastUpdatedAt,
          sources: ["blockscout-direct"],
          methodology: "page-bounded-descriptive-observation",
          eventUnit: "erc20-transfer-log",
          servedFrom: "neon-postgres",
        },
      });
    }

    const snapshot = await loadSnapshot();
    const data = snapshot ? pickWindow(snapshot.overview, window) : undefined;
    if (data && "activity" in data && "coverage" in data) {
      return NextResponse.json({
        data: { ...data, topTokens: [] },
        meta: {
          window,
          lastUpdatedAt: snapshot?.builtAt ?? new Date().toISOString(),
          sources: ["blockscout-direct"],
          methodology: "page-bounded-descriptive-observation",
          eventUnit: "erc20-transfer-log",
          servedFrom: "snapshot",
          degraded: database.attempted,
        },
      });
    }
    return uiOnlyResponse("capital-flow");
  } catch (error) {
    console.error("Failed to fetch capital flow:", error);
    return NextResponse.json({ error: "Failed to fetch capital flow" }, { status: 500 });
  }
}
