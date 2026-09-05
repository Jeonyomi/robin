import { NextResponse } from "next/server";
import { fetchLpLeaderboard } from "@/lib/sources/uniswap-v3/leaders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store, max-age=0" };
export async function GET(request: Request) {
  if ([...new URL(request.url).searchParams].length > 0) {
    return NextResponse.json({ data: null, error: "LP discovery does not accept wallet, token ID, or provider parameters." }, { status: 400, headers });
  }
  try { return NextResponse.json({ data: await fetchLpLeaderboard(), error: null }, { headers }); }
  catch (error) {
    // The adapter permits only fixed internal messages across this boundary.
    return NextResponse.json({ data: null, error: error instanceof Error ? error.message : "LP ranking data is unavailable." }, { status: 503, headers });
  }
}
