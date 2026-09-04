import { z } from "zod";
import { getAPIs } from "@/lib/config";
import { normalizeTokenAmount } from "@/lib/domain/activity";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const addressSchema = z.object({ hash: z.string() }).passthrough();
const totalSchema = z.object({
  decimals: z.string().nullable().optional(),
  value: z.string().nullable().optional(),
});

const transferSchema = z.object({
  block_number: z.union([z.number(), z.string()]),
  transaction_hash: z.string(),
  log_index: z.union([z.number(), z.string()]),
  timestamp: z.string(),
  from: addressSchema.nullable(),
  to: addressSchema.nullable(),
  token: z.object({
    address_hash: z.string(),
    decimals: z.string().nullable().optional(),
  }).passthrough(),
  total: totalSchema.nullable().optional(),
  method: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
}).passthrough();

const nextPageSchema = z.object({
  index: z.union([z.number(), z.string()]),
  block_number: z.union([z.number(), z.string()]),
}).nullable();

const responseSchema = z.object({
  items: z.array(transferSchema),
  next_page_params: nextPageSchema.optional(),
});

export type BlockscoutPageCursor = {
  index: number;
  blockNumber: number;
};

export type BlockscoutTransfer = {
  blockNumber: number;
  txHash: string;
  logIndex: number;
  tokenAddress: string;
  fromAddress: string;
  toAddress: string;
  rawValue: string | null;
  normalizedValue: number | null;
  timestamp: Date;
  method: string | null;
};

function headers(): Record<string, string> {
  const result: Record<string, string> = { Accept: "application/json", "User-Agent": BROWSER_UA };
  const key = getAPIs().blockscout.apiKey;
  if (key) result.Authorization = `Bearer ${key}`;
  return result;
}

export async function fetchTokenTransfers(
  tokenAddress: string,
  cursor?: BlockscoutPageCursor,
): Promise<{ items: BlockscoutTransfer[]; nextCursor: BlockscoutPageCursor | null }> {
  const base = getAPIs().blockscout.baseUrl;
  const url = new URL(`${base}/tokens/${tokenAddress.toLowerCase()}/transfers`);
  if (cursor) {
    url.searchParams.set("index", String(cursor.index));
    url.searchParams.set("block_number", String(cursor.blockNumber));
  }

  const response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(20_000) });
  if (response.status === 404) {
    return { items: [], nextCursor: null };
  }
  if (!response.ok) {
    throw new Error(`Blockscout transfer API failed: ${response.status}`);
  }

  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(`Invalid Blockscout transfer response: ${parsed.error.issues[0]?.message ?? "unknown schema error"}`);
  }

  const items = parsed.data.items.flatMap((item): BlockscoutTransfer[] => {
    if (!item.from?.hash || !item.to?.hash) return [];
    const blockNumber = Number(item.block_number);
    const logIndex = Number(item.log_index);
    const timestamp = new Date(item.timestamp);
    if (!Number.isSafeInteger(blockNumber) || !Number.isSafeInteger(logIndex) || Number.isNaN(timestamp.getTime())) {
      return [];
    }

    const rawValue = item.total?.value ?? null;
    const decimalsRaw = item.total?.decimals ?? item.token.decimals ?? null;
    const decimals = decimalsRaw === null ? null : Number(decimalsRaw);

    return [{
      blockNumber,
      txHash: item.transaction_hash.toLowerCase(),
      logIndex,
      tokenAddress: item.token.address_hash.toLowerCase(),
      fromAddress: item.from.hash.toLowerCase(),
      toAddress: item.to.hash.toLowerCase(),
      rawValue,
      normalizedValue: normalizeTokenAmount(rawValue, Number.isInteger(decimals) ? decimals : null),
      timestamp,
      method: item.method ?? null,
    }];
  });

  const next = parsed.data.next_page_params;
  return {
    items,
    nextCursor: next
      ? { index: Number(next.index), blockNumber: Number(next.block_number) }
      : null,
  };
}
