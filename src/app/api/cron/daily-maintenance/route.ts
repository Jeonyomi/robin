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

    // Fail the HTTP request when the job fails so the scheduler cannot record
    // a false success.
    const canonicalAssets = await syncCanonicalAssets();

    // Future jobs can be added here:
    // results.referencePrices = await syncReferencePrices();
    // results.blockscoutMetrics = await syncBlockscoutMetrics();
    // results.signals = await recalculateSignals();

    return NextResponse.json({
      data: { canonicalAssets },
      meta: {
        job: "daily-maintenance",
        completedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Daily maintenance cron failed:", error);
    return NextResponse.json(
      { error: "Cron job failed" },
      { status: 500 }
    );
  }
}
