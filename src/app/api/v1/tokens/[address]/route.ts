import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dataAvailable, uiOnlyResponse } from "@/lib/api-helpers";
import { getTokenDetailData } from "@/lib/queries";
import { loadSnapshot } from "@/lib/snapshot";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    const { address } = await params;
    const normalizedAddress = address.toLowerCase();

    if (!dataAvailable()) {
      const snap = await loadSnapshot();
      const data = snap?.tokenDetails?.[normalizedAddress] || null;
      if (data) {
        return NextResponse.json({
          data,
          meta: {
            lastUpdatedAt: snap?.builtAt || new Date().toISOString(),
            servedFrom: "snapshot",
          },
        });
      }
      // Token genuinely unknown (either no snapshot or not synced)
      if (snap) {
        return NextResponse.json({ error: "Token not found", data: null }, { status: 404 });
      }
      return uiOnlyResponse("tokens/[address]");
    }

    const data = await getTokenDetailData(getDb(), normalizedAddress);
    if (!data) {
      return NextResponse.json({ error: "Token not found", data: null }, { status: 404 });
    }

    return NextResponse.json({
      data,
      meta: {
        lastUpdatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Failed to fetch token detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch token", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
