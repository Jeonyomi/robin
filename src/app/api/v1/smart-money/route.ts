import { NextResponse } from "next/server";

export async function GET() {
  try {
    return NextResponse.json({
      data: [],
      meta: {
        lastUpdatedAt: new Date().toISOString(),
        note: "Smart money wallets will appear after wallet feature scoring runs.",
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
