import { NextResponse } from "next/server";
import { fetchSharedLpSnapshot, lpSnapshotPolicy } from "@/lib/sources/uniswap-v3/snapshot";
import { safeLpUnavailable } from "@/lib/sources/uniswap-v3/availability";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store, max-age=0" };
export async function GET(request: Request) {
  if ([...new URL(request.url).searchParams].length > 0) {
    return NextResponse.json({ data: null, error: "LP discovery does not accept wallet, token ID, or provider parameters." }, { status: 400, headers });
  }
  try { return NextResponse.json({ data: await fetchSharedLpSnapshot(), error: null, meta: lpSnapshotPolicy }, { headers }); }
  catch (error) {
    const safe = safeLpUnavailable(error);
    // Only success snapshots enter the shared cache. Error responses cannot be cached
    // by a browser/CDN and cannot reset the server's source cooldown or observation time.
    return NextResponse.json({ data: null, error: safe.message }, { status: safe.limited ? 429 : 503, headers: { ...headers, "Retry-After": String(safe.retryAfterSeconds) } });
  }
}
