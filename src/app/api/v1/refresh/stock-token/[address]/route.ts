import { NextResponse } from "next/server";

// Global cooldown state (in-memory, resets on cold start)
const refreshCooldowns = new Map<string, number>();

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

function isOnCooldown(scope: string): boolean {
  const lastRefresh = refreshCooldowns.get(scope);
  if (!lastRefresh) return false;
  return Date.now() - lastRefresh < COOLDOWN_MS;
}

function setCooldown(scope: string): void {
  refreshCooldowns.set(scope, Date.now());
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    const { address } = await params;
    const normalizedAddress = address.toLowerCase();
    const scope = `stock-token:${normalizedAddress}`;

    // Check cooldown
    if (isOnCooldown(scope)) {
      return NextResponse.json({
        data: { refreshed: false, freshEnough: true },
        meta: { scope, cooldownRemainingMs: COOLDOWN_MS - (Date.now() - (refreshCooldowns.get(scope) || 0)) },
      });
    }

    // Mark as refreshing
    setCooldown(scope);

    // In P0, refresh is a stub — real implementation fetches from Blockscout + Robinhood
    // and upserts to DB. For now, return success to indicate the endpoint works.
    return NextResponse.json({
      data: {
        refreshed: true,
        tokenAddress: normalizedAddress,
        lastUpdated: new Date().toISOString(),
      },
      meta: {
        scope,
        source: "blockscout",
        partial: false,
      },
    });
  } catch (error) {
    console.error("Refresh stock-token failed:", error);
    return NextResponse.json(
      { error: "Refresh failed", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
