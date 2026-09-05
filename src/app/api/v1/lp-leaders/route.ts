import { NextResponse } from "next/server";
import { fetchSharedLpSnapshot, lpSnapshotPolicy } from "@/lib/sources/uniswap-v3/snapshot";
import { safeLpUnavailable } from "@/lib/sources/uniswap-v3/availability";

export const dynamic = "force-dynamic";
export const maxDuration = 15;
const headers = { "Cache-Control": "no-store, max-age=0" };
export async function GET(request: Request) {
  if ([...new URL(request.url).searchParams].length > 0) {
    return NextResponse.json({ data: null, error: "LP discovery does not accept wallet, token ID, or provider parameters." }, { status: 400, headers });
  }
  try {
    const { data, collector } = await fetchSharedLpSnapshot();
    return NextResponse.json({ data, error: null, meta: { ...lpSnapshotPolicy, collector } }, { headers });
  }
  catch (error) {
    const safe = safeLpUnavailable(error);
    // Missing, expired, or unreadable stored observations fail closed. No RPC fallback.
    return NextResponse.json({ data: null, error: safe.message }, { status: safe.limited ? 429 : 503, headers: { ...headers, "Retry-After": String(safe.retryAfterSeconds) } });
  }
}
