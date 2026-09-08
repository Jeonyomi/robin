import { publicRpcGate, PublicRpcBusyError } from "@/lib/sources/public-rpc-gate";
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
    const data = await publicRpcGate.run(`legacy:${tokenIds[0]}`, () => fetchLpPosition(tokenIds[0]), { cost: 17, accept: (value) => {
      const age = Date.now() - Date.parse(value.observedAt);
      return Number.isFinite(age) && age >= -30_000 && age <= 120_000;
    } });
    return Response.json({ data, meta: {
      source: "Robinhood Chain public RPC",
      fees: "withheld",
      performance: "withheld",
      reason: "Public read-only position, not asserted to belong to you. Prices are approximate token1 per token0. Fee accounting and cash-flow history are not verified; no APR, IL, or PnL is inferred. Public RPC is rate-limited and has no production SLA.",
    } }, { headers });
  } catch (error) {
    if (error instanceof PublicRpcBusyError) return Response.json({ data: null, error: error.message },
      { status: 429, headers: { ...headers, "Retry-After": String(error.retryAfterSeconds) } });
    // Never expose provider exceptions or serve a previous successful snapshot.
    return Response.json({ data: null, error: "Public position data is unavailable or could not be verified. The tokenId may not exist; retry later." },
      { status: 503, headers });
  }
}
