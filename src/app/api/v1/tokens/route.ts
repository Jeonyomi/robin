import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dataAvailable, uiOnlyResponse } from "@/lib/api-helpers";
import { getTokensScannerData, sortScannerItems } from "@/lib/queries";
import { loadSnapshot } from "@/lib/snapshot";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sort = searchParams.get("sort") || "holders";

    if (!dataAvailable()) {
      const snap = await loadSnapshot();
      if (snap) {
        return NextResponse.json({
          data: sortScannerItems(snap.tokensScanner, sort),
          meta: {
            sort,
            lastUpdatedAt: snap.builtAt || new Date().toISOString(),
            sources: ["blockscout", "robinhood"],
            servedFrom: "snapshot",
          },
        });
      }
      return uiOnlyResponse("tokens");
    }

    const list = await getTokensScannerData(getDb());
    return NextResponse.json({
      data: sortScannerItems(list, sort),
      meta: {
        sort,
        lastUpdatedAt: new Date().toISOString(),
        sources: ["blockscout", "robinhood"],
      },
    });
  } catch (error) {
    console.error("Failed to fetch tokens:", error);
    return NextResponse.json(
      { error: "Failed to fetch tokens", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
