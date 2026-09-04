import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  invalidWindowResponse,
  parseObservationWindow,
  tryDatabase,
  uiOnlyResponse,
} from "@/lib/api-helpers";
import { getStockTokensData } from "@/lib/queries";
import { loadSnapshot, pickWindow } from "@/lib/snapshot";

export async function GET(request: Request) {
  try {
    const window = parseObservationWindow(request);
    if (!window) return invalidWindowResponse();
    const { searchParams } = new URL(request.url);
    const canonicalOnly = searchParams.get("canonicalOnly") === "true";

    const database = await tryDatabase(() =>
      getStockTokensData(getDb(), window, canonicalOnly),
    );
    if (database.ok) {
      return NextResponse.json({
        data: database.data,
        meta: {
          window,
          canonicalOnly,
          lastUpdatedAt: new Date().toISOString(),
          sources: ["blockscout", "robinhood"],
          servedFrom: "neon-postgres",
        },
      });
    }

    const snap = await loadSnapshot();
    let rows = snap ? pickWindow(snap.stockTokens, window) : undefined;
    if (rows) {
      if (canonicalOnly) rows = rows.filter((row) => row.canonicalStatus === "CANONICAL");
      return NextResponse.json({
        data: rows,
        meta: {
          window,
          canonicalOnly,
          lastUpdatedAt: snap?.builtAt ?? new Date().toISOString(),
          sources: ["blockscout", "robinhood"],
          servedFrom: "snapshot",
          degraded: database.attempted,
        },
      });
    }
    return uiOnlyResponse("stock-tokens");
  } catch (error) {
    console.error("Failed to fetch stock tokens:", error);
    return NextResponse.json({ error: "Failed to fetch stock tokens" }, { status: 500 });
  }
}
