import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { tryDatabase, uiOnlyResponse } from "@/lib/api-helpers";
import { getOverviewData } from "@/lib/queries";
import { loadSnapshot, pickWindow } from "@/lib/snapshot";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const window = searchParams.get("window") || "24h";

    const database = await tryDatabase(() => getOverviewData(getDb(), window));
    if (database.ok) {
      return NextResponse.json({
        data: database.data,
        meta: {
          window,
          lastUpdatedAt: database.data.lastUpdatedAt,
          sources: ["blockscout-direct"],
          methodology: "descriptive-observation",
          servedFrom: "neon-postgres",
        },
      });
    }

    const snapshot = await loadSnapshot();
    const data = snapshot ? pickWindow(snapshot.overview, window) : undefined;
    if (data && "activity" in data && "coverage" in data) {
      return NextResponse.json({
        data,
        meta: {
          window,
          lastUpdatedAt: snapshot?.builtAt ?? new Date().toISOString(),
          sources: ["blockscout-direct"],
          methodology: "descriptive-observation",
          servedFrom: "snapshot",
          degraded: database.attempted,
        },
      });
    }
    return uiOnlyResponse("capital-flow");
  } catch (error) {
    console.error("Failed to fetch capital flow:", error);
    return NextResponse.json(
      { error: "Failed to fetch capital flow" },
      { status: 500 }
    );
  }
}
