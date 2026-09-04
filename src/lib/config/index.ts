import { z } from "zod";

// ── Environment Validation ──────────────────────────────────────────────────

const envSchema = z.object({
  // App
  NEXT_PUBLIC_APP_NAME: z.string().default("Robinhood Chain Opportunity Intelligence"),
  NEXT_PUBLIC_CHAIN_ID: z.coerce.number().default(4663),
  NEXT_PUBLIC_EXPLORER_URL: z.string().url().default("https://robinhoodchain.blockscout.com"),

  // Database
  DATABASE_URL: z.string().default(""),
  DATABASE_URL_UNPOOLED: z.string().optional(),

  // Robinhood Chain
  ROBINHOOD_RPC_URL: z.string().url().default("https://rpc.mainnet.chain.robinhood.com"),
  ROBINHOOD_ASSETS_API_URL: z.string().url().default("https://api.robinhood.com/rhj/assets"),
  ROBINHOOD_API_BASE_URL: z.string().url().default("https://api.robinhood.com"),

  // Blockscout
  BLOCKSCOUT_API_BASE_URL: z.string().url().default("https://robinhoodchain.blockscout.com/api/v2"),
  BLOCKSCOUT_API_KEY: z.string().optional(),

  // Secrets — default to empty so build passes; validated at runtime
  CRON_SECRET: z.string().default(""),
  ADMIN_SYNC_SECRET: z.string().default(""),

  // Optional Redis
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
});

let _env: z.infer<typeof envSchema> | null = null;

function loadEnv() {
  if (_env) return _env;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }

  _env = parsed.data;
  return _env;
}

/** Lazy env — validates only at first access, not at module load / build time */
export const env = new Proxy({} as z.infer<typeof envSchema>, {
  get(_target, prop) {
    const loaded = loadEnv();
    return loaded[prop as keyof typeof loaded];
  },
});

// ── Derived Config (lazy) ──────────────────────────────────────────────────

let _chain: { id: number; name: string; rpcUrl: string; explorerUrl: string } | null = null;
let _apis: { blockscout: { baseUrl: string; apiKey: string | undefined }; robinhood: { assetsUrl: string; baseUrl: string } } | null = null;

export function getChain() {
  if (!_chain) _chain = { id: env.NEXT_PUBLIC_CHAIN_ID, name: "Robinhood Chain", rpcUrl: env.ROBINHOOD_RPC_URL, explorerUrl: env.NEXT_PUBLIC_EXPLORER_URL };
  return _chain;
}

export function getAPIs() {
  if (!_apis) _apis = { blockscout: { baseUrl: env.BLOCKSCOUT_API_BASE_URL, apiKey: env.BLOCKSCOUT_API_KEY }, robinhood: { assetsUrl: env.ROBINHOOD_ASSETS_API_URL, baseUrl: env.ROBINHOOD_API_BASE_URL } };
  return _apis;
}

/** Runtime check — call before any operation that requires secrets */
export function requireEnv() {
  const d = env;
  const missing: string[] = [];
  if (!d.DATABASE_URL) missing.push("DATABASE_URL");
  if (!d.CRON_SECRET) missing.push("CRON_SECRET");
  if (!d.ADMIN_SYNC_SECRET) missing.push("ADMIN_SYNC_SECRET");
  if (missing.length > 0) throw new Error(`Missing required env vars: ${missing.join(", ")}`);
}

// ── Sync Config ─────────────────────────────────────────────────────────────

export const SYNC_COOLDOWN = {
  referencePrice: 5 * 60 * 1000,     // 5 min
  canonicalRegistry: 60 * 60 * 1000,  // 60 min
  opportunityAggregate: 15 * 60 * 1000, // 15 min
  contractMetadata: 24 * 60 * 60 * 1000, // 24 h
} as const;

// ── Risk Config ─────────────────────────────────────────────────────────────

export const RISK_WEIGHTS = {
  contractRisk: 25,
  liquidityRisk: 20,
  holderConcentration: 20,
  marketManipulation: 15,
  identityRisk: 10,
  dataQualityRisk: 10,
} as const;

export const RISK_GATES = {
  tickerCollision: true,
  noExecutableLiquidity: { minDepthUsd: 10000 },
  extremeConcentration: { maxTop10Share: 0.5 },
  activityAnomaly: { maxTransfersPerHolder: 100 },
  contractPrivilege: { requireVerification: true },
} as const;

// ── Opportunity Score Config ────────────────────────────────────────────────

export const OPPORTUNITY_WEIGHTS = {
  capitalFlow: 0.23,
  adoptionMomentum: 0.18,
  liquidityQuality: 0.18,
  smartMoney: 0.15,
  relativeValue: 0.11,
  catalyst: 0.15,
} as const;

// ── Signal Config ───────────────────────────────────────────────────────────

export const SIGNAL_CONFIG = {
  smartAccumulation: {
    smartMoneyFlowPercentile: 75,
    minHolderGrowth: 0,
    minUniqueBuyerGrowth: 0,
    minLiquidityChange: 0,
    maxConcentrationIncrease: 0.05,
  },
  capitalRotation: {
    bridgeInflowZscoreThreshold: 2.0,
    minDestinationBuy: 0,
    minLiquidityChange: 0,
  },
  newTokenBreakout: {
    minAgeHours: 24,
    minLiquidityUsd: 5000,
    minUniqueBuyers: 10,
    requireSellTransaction: true,
    maxTop10Share: 0.3,
  },
  stockTokenDivergence: {
    minAbsPremiumDiscount: 0.01,
    minExecutableDepthUsd: 5000,
    maxStalenessMinutes: 60,
  },
  fakeMomentumWarning: {
    maxTransfersPerHolder: 100,
    minSybilRatio: 0.3,
    minPriceLiquidityDivergence: 0.2,
  },
} as const;
