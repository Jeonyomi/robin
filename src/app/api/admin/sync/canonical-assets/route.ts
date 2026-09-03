import { NextResponse } from "next/server";
import { syncCanonicalAssets } from "@/lib/jobs/sync-canonical-assets";

export async function POST(request: Request) {
  try {
    // Validate admin secret
    const authHeader = request.headers.get("authorization");
    const secret = process.env.ADMIN_SYNC_SECRET;
    if (!secret || authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await syncCanonicalAssets();

    return NextResponse.json({
      data: result,
      meta: {
        job: "canonical-assets",
        completedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Admin sync canonical-assets failed:", error);
    return NextResponse.json(
      { error: "Sync failed", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
