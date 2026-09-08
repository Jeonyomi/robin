import { fetchMemeLeaders } from "@/lib/sources/meme-leaders";

export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "no-store, max-age=0" };
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.size) return Response.json({ data: null, error: "This bounded feed takes no query parameters." }, { status: 400, headers });
  try {
    const data = await fetchMemeLeaders();
    const age = Date.now() - Date.parse(data.retrievedAt);
    if (!Number.isFinite(age) || age < 0 || age > 300_000) throw new Error("Expired feed.");
    return Response.json({ data, error: null }, { headers });
  } catch {
    return Response.json({ data: null, error: "Trending feed or canonical registry is unavailable. No stale ranking has been substituted. Retry after the cooldown." }, { status: 503, headers: { ...headers, "Retry-After": "30" } });
  }
}
