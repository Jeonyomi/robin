import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const window = searchParams.get("window") || "24h";

    return NextResponse.json({
      data: {
        bridgeInflow: 0,
        bridgeOutflow: 0,
        netFlow: 0,
        usdgFlow: 0,
        wethFlow: 0,
        topDestinations: [],
        timeline: [],
      },
      meta: {
        window,
        lastUpdatedAt: new Date().toISOString(),
        sources: ["blockscout"],
        note: "Capital flow data will populate after bridge event ingestion.",
      },
    });
  } catch (error) {
    console.error("Failed to fetch capital flow:", error);
    return NextResponse.json(
      { error: "Failed to fetch capital flow" },
      { status: 500 }
    );
  }
}
