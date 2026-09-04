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
        data: database.data.topTokens,
        meta: {
          window,
          lastUpdatedAt: database.data.lastUpdatedAt,
          sources: ["blockscout-direct", "robinhood-assets"],
          methodology: "60% relative transfer count + 40% relative active addresses",
          meaning: "Activity Index is descriptive and is not an investment recommendation.",
          servedFrom: "neon-postgres",
        },
      });
    }

    const snapshot = await loadSnapshot();
    const data = snapshot ? pickWindow(snapshot.overview, window) : undefined;
    if (data?.topTokens) {
      return NextResponse.json({
        data: data.topTokens,
        meta: {
          window,
          lastUpdatedAt: snapshot?.builtAt ?? new Date().toISOString(),
          sources: ["blockscout-direct", "robinhood-assets"],
          methodology: "60% relative transfer count + 40% relative active addresses",
          meaning: "Activity Index is descriptive and is not an investment recommendation.",
          servedFrom: "snapshot",
          degraded: database.attempted,
        },
      });
    }
    return uiOnlyResponse("opportunities");
  } catch (error) {
    console.error("Failed to fetch opportunities:", error);
    return NextResponse.json(
      { error: "Failed to fetch opportunities" },
      { status: 500 }
    );
  }
}
