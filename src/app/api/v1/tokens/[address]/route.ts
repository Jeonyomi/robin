import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { tryDatabase, uiOnlyResponse } from "@/lib/api-helpers";
import { getTokenDetailData } from "@/lib/queries";
import { loadSnapshot } from "@/lib/snapshot";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    const { address } = await params;
    const normalizedAddress = address.toLowerCase();

    const database = await tryDatabase(() =>
      getTokenDetailData(getDb(), normalizedAddress),
    );
    if (database.ok) {
      if (!database.data) {
        return NextResponse.json({ error: "Token not found", data: null }, { status: 404 });
      }
      return NextResponse.json({
        data: database.data,
        meta: {
          lastUpdatedAt: new Date().toISOString(),
          servedFrom: "neon-postgres",
        },
      });
    }

    const snap = await loadSnapshot();
    const data = snap?.tokenDetails?.[normalizedAddress] || null;
    if (data) {
      return NextResponse.json({
        data,
        meta: {
          lastUpdatedAt: snap?.builtAt || new Date().toISOString(),
          servedFrom: "snapshot",
          degraded: database.attempted,
        },
      });
    }
    if (snap) {
      return NextResponse.json({ error: "Token not found", data: null }, { status: 404 });
    }
    return uiOnlyResponse("tokens/[address]");
  } catch (error) {
    console.error("Failed to fetch token detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch token", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
