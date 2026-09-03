import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dataAvailable, uiOnlyResponse } from "@/lib/api-helpers";
import { getStockTokensData } from "@/lib/queries";
import { loadSnapshot, pickWindow } from "@/lib/snapshot";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const window = searchParams.get("window") || "24h";
    const canonicalOnly = searchParams.get("canonicalOnly") === "true";

    if (!dataAvailable()) {
      const snap = await loadSnapshot();
      let rows = snap ? pickWindow(snap.stockTokens, window) : undefined;
      if (rows) {
        if (canonicalOnly) rows = rows.filter((r) => r.canonicalStatus === "CANONICAL");
        return NextResponse.json({
          data: rows,
          meta: {
            window,
            canonicalOnly,
            lastUpdatedAt: snap?.builtAt || new Date().toISOString(),
            sources: ["blockscout", "robinhood"],
            servedFrom: "snapshot",
          },
        });
      }
      return uiOnlyResponse("stock-tokens");
    }

    const enriched = await getStockTokensData(getDb(), window, canonicalOnly);
    return NextResponse.json({
      data: enriched,
      meta: {
        window,
        canonicalOnly,
        lastUpdatedAt: new Date().toISOString(),
        sources: ["blockscout", "robinhood"],
      },
    });
  } catch (error) {
    console.error("Failed to fetch stock tokens:", error);
    return NextResponse.json(
      { error: "Failed to fetch stock tokens", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
