import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") || undefined;
    const window = searchParams.get("window") || "24h";
    const riskMax = searchParams.get("riskMax") ? Number(searchParams.get("riskMax")) : undefined;
    const canonicalOnly = searchParams.get("canonicalOnly") === "true";

    // P0: Return mock structure — real data comes from DB after sync jobs run
    // The opportunity engine will populate this from token_metric_snapshots + signals
    return NextResponse.json({
      data: [],
      meta: {
        window,
        category: category || "all",
        riskMax: riskMax ?? null,
        canonicalOnly,
        lastUpdatedAt: new Date().toISOString(),
        sources: ["blockscout", "robinhood"],
        note: "No DB connected yet. Opportunities will appear after canonical sync and metric calculation.",
      },
    });
  } catch (error) {
    console.error("Failed to fetch opportunities:", error);
    return NextResponse.json(
      { error: "Failed to fetch opportunities" },
      { status: 500 }
    );
  }
}
