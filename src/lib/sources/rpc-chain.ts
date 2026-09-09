import { z } from "zod";
import { getChain } from "@/lib/config";

const hexQuantity = z.string().regex(/^0x[0-9a-f]+$/i);
const rpcResponse = z.object({ result: hexQuantity });

export type RpcChainSnapshot = {
  latestBlock: number;
  gasPricesGwei: { slow: null; average: number; fast: null };
  source: "rpc";
  observedAt: string;
};

async function rpc(url: string, id: number, method: string): Promise<bigint> {
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: [] }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`RPC chain request failed: ${response.status}`);
  const parsed = rpcResponse.safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid RPC chain response");
  return BigInt(parsed.data.result);
}

export async function fetchRpcChainSnapshot(): Promise<RpcChainSnapshot> {
  const chain = getChain();
  if (chain.id !== 4663) throw new Error("Invalid RPC chain configuration");
  const [block, gasWei] = await Promise.all([
    rpc(chain.rpcUrl, 1, "eth_blockNumber"),
    rpc(chain.rpcUrl, 2, "eth_gasPrice"),
  ]);
  const latestBlock = Number(block);
  const average = Number(gasWei) / 1e9;
  if (!Number.isSafeInteger(latestBlock) || !Number.isFinite(average) || average < 0) {
    throw new Error("Invalid RPC chain response");
  }
  return {
    latestBlock,
    gasPricesGwei: { slow: null, average, fast: null },
    source: "rpc",
    observedAt: new Date().toISOString(),
  };
}
