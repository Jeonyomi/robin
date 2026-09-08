import { z } from "zod";
import { getAPIs } from "@/lib/config";
import { fetchSourceJson, SourceRequestError } from "../source-request";
import { normalizeTokenAmount } from "@/lib/domain/activity";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const identityInteger = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .refine(value => Number.isSafeInteger(Number(value)));
const addressSchema = z.object({ hash: address }).passthrough();
const totalSchema = z.object({
  decimals: z.string().nullable().optional(),
  value: z.string().nullable().optional(),
});

const transferSchema = z.object({
  block_number: identityInteger,
  transaction_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  log_index: identityInteger,
  timestamp: z.iso.datetime({ offset: true }).refine(value => Date.parse(value) <= Date.now()),
  from: addressSchema,
  to: addressSchema,
  token: z.object({
    address_hash: address,
    decimals: z.string().nullable().optional(),
  }).passthrough(),
  total: totalSchema.nullable().optional(),
  method: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
}).passthrough();

const nextPageSchema = z.object({
  index: identityInteger,
  block_number: identityInteger,
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
  if (!address.safeParse(tokenAddress).success || (cursor &&
    (!identityInteger.safeParse(cursor.index).success || !identityInteger.safeParse(cursor.blockNumber).success))) {
    throw new SourceRequestError("schema");
  }
  const base = getAPIs().blockscout.baseUrl;
  const url = new URL(`${base}/tokens/${tokenAddress.toLowerCase()}/transfers`);
  if (cursor) {
    url.searchParams.set("index", String(cursor.index));
    url.searchParams.set("block_number", String(cursor.blockNumber));
  }

  const response = await fetchSourceJson("blockscout", url.toString(), { headers: headers(), scope: "transfers", timeoutMs: 20_000, allow404: false });
  const parsed = responseSchema.safeParse(response);
  if (!parsed.success) throw new SourceRequestError("schema");

  const items = parsed.data.items.map((item): BlockscoutTransfer => {
    if (item.token.address_hash.toLowerCase() !== tokenAddress.toLowerCase()) throw new SourceRequestError("schema");
    const blockNumber = Number(item.block_number);
    const logIndex = Number(item.log_index);
    const timestamp = new Date(item.timestamp);

    const rawValue = item.total?.value ?? null;
    const decimalsRaw = item.total?.decimals ?? item.token.decimals ?? null;
    const decimals = decimalsRaw === null ? null : Number(decimalsRaw);

    return {
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
    };
  });

  const next = parsed.data.next_page_params;
  return {
    items,
    nextCursor: next
      ? { index: Number(next.index), blockNumber: Number(next.block_number) }
      : null,
  };
}
