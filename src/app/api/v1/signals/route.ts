import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || undefined;
    const entityId = searchParams.get("entityId") || undefined;
    const confidence = searchParams.get("confidence") || undefined;

    return NextResponse.json({
      data: [],
      meta: {
        type: type || "all",
        entityId: entityId || null,
        confidence: confidence || null,
        lastUpdatedAt: new Date().toISOString(),
        note: "Signals will appear after metric calculation runs.",
      },
    });
  } catch (error) {
    console.error("Failed to fetch signals:", error);
    return NextResponse.json(
      { error: "Failed to fetch signals" },
      { status: 500 }
    );
  }
}
