import { fetchLpPosition, isValidLpTokenId } from "@/lib/sources/uniswap-v3/position";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tokenIds = params.getAll("tokenId");
  if (tokenIds.length !== 1 || !isValidLpTokenId(tokenIds[0])
    || [...params.keys()].some((key) => key !== "tokenId")) {
    return Response.json({ data: null, error: "Provide exactly one positive decimal tokenId (uint256), without leading zeros or other parameters." },
      { status: 400, headers });
  }
  try {
    const data = await fetchLpPosition(tokenIds[0]);
    return Response.json({ data, meta: {
      source: "Robinhood Chain public RPC",
      fees: "withheld",
      performance: "withheld",
      reason: "Public read-only position, not asserted to belong to you. Prices are approximate token1 per token0. Fee accounting and cash-flow history are not verified; no APR, IL, or PnL is inferred. Public RPC is rate-limited and has no production SLA.",
    } }, { headers });
  } catch {
    // Never expose provider exceptions or serve a previous successful snapshot.
    return Response.json({ data: null, error: "Public position data is unavailable or could not be verified. The tokenId may not exist; retry later." },
      { status: 503, headers });
  }
}
