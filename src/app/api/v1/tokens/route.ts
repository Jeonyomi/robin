import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { tryDatabase, uiOnlyResponse } from "@/lib/api-helpers";
import { getTokensScannerData, sortScannerItems } from "@/lib/queries";
import { loadSnapshot } from "@/lib/snapshot";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sort = searchParams.get("sort") || "holders";

    const database = await tryDatabase(() => getTokensScannerData(getDb()));
    if (database.ok) {
      return NextResponse.json({
        data: sortScannerItems(database.data, sort),
        meta: {
          sort,
          lastUpdatedAt: new Date().toISOString(),
          sources: ["blockscout", "robinhood"],
          servedFrom: "neon-postgres",
        },
      });
    }

    const snap = await loadSnapshot();
    if (snap) {
      return NextResponse.json({
        data: sortScannerItems(snap.tokensScanner, sort),
        meta: {
          sort,
          lastUpdatedAt: snap.builtAt,
          sources: ["blockscout", "robinhood"],
          servedFrom: "snapshot",
          degraded: database.attempted,
        },
      });
    }
    return uiOnlyResponse("tokens");
  } catch (error) {
    console.error("Failed to fetch tokens:", error);
    return NextResponse.json(
      { error: "Failed to fetch tokens", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
