import { NextResponse } from "next/server";
import { syncCanonicalAssets } from "@/lib/jobs/sync-canonical-assets";

export async function GET(request: Request) {
  try {
    // Validate cron secret (Vercel sends Authorization: Bearer <CRON_SECRET>)
    const authHeader = request.headers.get("authorization");
    const secret = process.env.CRON_SECRET;
    if (!secret || authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const results: Record<string, unknown> = {};

    // Job 1: Sync canonical assets
    try {
      results.canonicalAssets = await syncCanonicalAssets();
    } catch (error) {
      results.canonicalAssets = {
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    // Future jobs can be added here:
    // results.referencePrices = await syncReferencePrices();
    // results.blockscoutMetrics = await syncBlockscoutMetrics();
    // results.signals = await recalculateSignals();

    return NextResponse.json({
      data: results,
      meta: {
        job: "daily-maintenance",
        completedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Daily maintenance cron failed:", error);
    return NextResponse.json(
      { error: "Cron job failed", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
