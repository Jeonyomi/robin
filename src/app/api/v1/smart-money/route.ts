import { NextResponse } from "next/server";

export async function GET() {
  try {
    return NextResponse.json({
      data: [],
      meta: {
        lastUpdatedAt: new Date().toISOString(),
        status: "disabled",
        note: "Wallet intelligence is not asserted without decoded trades, validated prices, and attribution evidence.",
      },
    });
  } catch (error) {
    console.error("Failed to fetch smart money:", error);
    return NextResponse.json(
      { error: "Failed to fetch smart money" },
      { status: 500 }
    );
  }
}
