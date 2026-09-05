import { z } from "zod";

const finite = z.number().finite().nonnegative();
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const rawAmount = z.string().regex(/^\d+$/);
export const LpLeaderSchema = z.object({
  tokenId: z.string().regex(/^[1-9]\d*$/), pool: address, owner: address,
  token0: z.object({ address, symbol: z.string().min(1).max(24), decimals: z.number().int().min(0).max(36) }),
  token1: z.object({ address, symbol: z.string().min(1).max(24), decimals: z.number().int().min(0).max(36) }),
  baseSymbol: z.string().min(1).max(24), baseAddress: address,
  feeTier: z.number().int().positive(), feeIncomeWeth: finite, spotFeeValueWeth: finite.optional(), capitalWeth: finite,
  fees0: rawAmount, fees1: rawAmount, amount0: finite, amount1: finite,
  priceWethPerBase: finite.positive(), lowerWethPerBase: finite.positive(), upperWethPerBase: finite.positive(),
  rangeState: z.enum(["in-range", "below-range", "above-range", "closed"]),
  rangeWidthPct: finite, nearestEdgePct: finite,
  structure: z.enum(["full-range", "wide", "concentrated"]),
  mintedAt: z.string().datetime(), increases: z.number().int().positive(), decreases: z.number().int().nonnegative(),
  collections: z.number().int().nonnegative(), transfers: z.number().int().nonnegative().nullable(),
});
export type LpLeader = z.infer<typeof LpLeaderSchema>;
export const LpLeaderboardSchema = z.object({
  chainId: z.literal(4663), protocol: z.literal("uniswap-v3"), positionManager: address, weth: address,
  blockNumber: rawAmount, blockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), observedAt: z.string().datetime(),
  totalNfts: z.number().int().nonnegative(), sampled: z.number().int().nonnegative(),
  eligible: z.number().int().nonnegative(), excluded: z.number().int().nonnegative(), unsupported: z.number().int().nonnegative(),
  sampleMethod: z.literal("stratified-enumerable-indices-v1"),
  ranking: z.literal("lifetime-native-weth-fees"),
  rows: z.array(LpLeaderSchema).max(64),
});
export type LpLeaderboard = z.infer<typeof LpLeaderboardSchema>;

// Research snapshots, never labeled live: source age remains bounded even on cache hits.
export const LP_LEADER_FRESH_MS = 300_000;
export function isFreshLeaderboard(data: Pick<LpLeaderboard, "observedAt">, now = Date.now()) {
  const age = now - Date.parse(data.observedAt);
  return Number.isFinite(age) && age >= -30_000 && age <= LP_LEADER_FRESH_MS;
}
export function rankLpLeaders(rows: LpLeader[]) {
  return [...rows].sort((a, b) => b.feeIncomeWeth - a.feeIncomeWeth || (BigInt(a.tokenId) < BigInt(b.tokenId) ? -1 : BigInt(a.tokenId) > BigInt(b.tokenId) ? 1 : 0));
}
