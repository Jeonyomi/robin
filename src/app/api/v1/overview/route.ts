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
          sources: ["blockscout", "robinhood"],
          lastUpdatedAt: new Date().toISOString(),
          calculationVersion: "v1",
          servedFrom: "neon-postgres",
        },
      });
    }

    const snap = await loadSnapshot();
    const data = snap ? pickWindow(snap.overview, window) : undefined;
    if (data) {
      return NextResponse.json({
        data,
        meta: {
          window,
          sources: ["blockscout", "robinhood"],
          lastUpdatedAt: snap?.builtAt ?? new Date().toISOString(),
          calculationVersion: "v1",
          servedFrom: "snapshot",
          degraded: database.attempted,
        },
      });
    }
    return uiOnlyResponse("overview");
  } catch (error) {
    console.error("Failed to fetch overview:", error);
    return NextResponse.json(
      { error: "Failed to fetch overview", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
