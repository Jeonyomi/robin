import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { getOverviewData, type Db } from "../../src/lib/queries";
import { getDb } from "../../src/lib/db";
import { GET as overviewGET } from "../../src/app/api/v1/overview/route";
import { GET as capitalFlowGET } from "../../src/app/api/v1/capital-flow/route";
import { GET as opportunitiesGET } from "../../src/app/api/v1/opportunities/route";

// Never initialize the real database or read its environment configuration.
vi.mock("@/lib/db", () => ({ getDb: vi.fn(), hasDatabase: () => true }));
vi.mock("@/lib/snapshot", () => ({
  loadSnapshot: vi.fn(() => { throw new Error("Unexpected snapshot access"); }),
  pickWindow: vi.fn(),
  getSnapshotStatus: vi.fn(),
}));

const timestamp = "2026-01-01T12:00:00.000Z";
const zero = "0x0000000000000000000000000000000000000000";
const leaderRows = [
  { token_address: "0xlow", symbol: "LOW", name: "Low", current_transfers: "10", previous_transfers: "5", active_addresses: "4", holder_count: null, holder_delta: null, latest_block: "99", last_transfer_at: timestamp },
  { token_address: "0xhigh", symbol: "HIGH", name: "High", current_transfers: "20", previous_transfers: "10", active_addresses: "8", holder_count: "100", holder_delta: "2", latest_block: "100", last_transfer_at: timestamp },
];

function fakeDatabase(extraStates: unknown[][] = []) {
  const calls: { sql: string; params: unknown[]; arrayMode: boolean }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[], options: { arrayMode: boolean }) => {
    calls.push({ sql, params, arrayMode: options.arrayMode });
    if (sql.includes("WITH counts AS")) return { rows: leaderRows };
    if (sql.includes("WITH bucket_counts AS")) return { rows: [{ bucket: timestamp, transfers: "30", active_addresses: "12", mints: "1", burns: "2" }] };
    if (sql.includes("AS transfer_count")) return { rows: [{ transfer_count: "30", active_tokens: "2", active_addresses: "12", mint_events: "1", burn_events: "2", latest_block: "100", last_observed_at: timestamp }] };
    if (sql.includes('from "source_sync_state"')) return { rows: [
      ["token-transfers", { scannedInCycle: 2, completedCycles: 1, lastBatchSize: 2, lookbackHours: 48 }, timestamp, "success", "blockscout"],
      ["chain-stats", { totalBlocks: 100, totalTransactions: 200, totalAddresses: 50, observedAt: timestamp, gasPricesGwei: { slow: 1, average: 2, fast: 3 } }, timestamp, "success", "blockscout"],
      ...extraStates,
    ] };
    if (sql.includes("count(")) return { rows: [[2]] };
    if (sql.includes('from "token_transfers"')) return { rows: [["0xtx", 0, 100, "0xhigh", "HIGH", zero, "0xto", 3, timestamp]] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  // Real Drizzle compilation and result mapping; only the transport is fake.
  const db = drizzle({ client: { query } as unknown as NeonQueryFunction<false, false> }) as Db;
  return { db, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(timestamp));
});
afterEach(() => vi.useRealTimers());

describe("overview ranking query cost", () => {
  it("retains legacy last-good data but exposes failed active RPC collection", async () => {
    const { db } = fakeDatabase([["token-transfers", {}, null, "error", "rpc"]]);
    const data = await getOverviewData(db, "24h");
    expect(data.coverage).toMatchObject({ source: "blockscout", activeSource: "rpc", status: "error", lastIndexedAt: timestamp });
    expect(data.coverage.collectionMode).toBeUndefined();
  });
  it.each([["overview", overviewGET], ["capital-flow", capitalFlowGET], ["opportunities", opportunitiesGET]] as const)("%s reports mixed transfer provenance", async (endpoint, handler) => {
    vi.mocked(getDb).mockReturnValue(fakeDatabase().db);
    const body = await (await handler(new Request(`http://localhost/api/v1/${endpoint}`))).json();
    expect(body.meta.sources).toContain("mixed-historical-blockscout-rpc-transfers");
  });
  it("prefers accepted RPC scans without relabeling event or chain freshness", async () => {
    const scannedAt = "2026-01-01T11:59:00.000Z";
    const { db, calls } = fakeDatabase([["token-transfers", { collectionMode: "bounded-recent-rpc", scanFromBlock: 1000, scannedToBlock: 1063, skippedBlocks: 500, scannedAt, latestTransferAt: timestamp }, scannedAt, "success", "rpc"]]);
    const data = await getOverviewData(db, "24h");
    expect(data.coverage).toMatchObject({ source: "rpc", collectionMode: "bounded-recent-rpc", scanFromBlock: 1000, scannedToBlock: 1063, skippedBlocks: 500, scannedAt, latestTransferAt: timestamp, lastIndexedAt: scannedAt, observationExposureVerified: false });
    expect(data.chain?.totalBlocks).toBe(100);
    expect(data.activity.lastObservedAt).toBe(timestamp);
    expect(data.dataQuality.scope).toContain("recent RPC");
    expect(data.dataQuality.note).toContain("not backfilled");
    expect(data.dataQuality.note).not.toContain("Counts are page-bounded");
    expect(calls.find(c => c.sql.includes('from "source_sync_state"'))?.params).toEqual(["blockscout", "rpc"]);
  });

  it.each(["1h", "6h", "24h"])("%s observed-token count uses the collector canonical registry and selected window, never implies complete exposure", async (window) => {
    const { db, calls } = fakeDatabase();
    const data = await getOverviewData(db, window);
    const denominator = calls.find((call) => call.arrayMode && call.sql.includes("count(") && !call.sql.includes("DISTINCT"));
    const numerator = calls.find((call) => call.arrayMode && call.sql.includes("DISTINCT"));
    expect(denominator?.sql).toContain('from "canonical_assets"');
    expect(numerator?.sql).toContain('inner join "canonical_assets"');
    expect(numerator?.sql).toContain('"token_transfers"."token_address" = "canonical_assets"."contract_address"');
    expect(numerator?.sql).toContain('"token_transfers"."timestamp" >=');
    expect(numerator?.sql).toContain('"token_transfers"."timestamp" <=');
    const hours = Number(window.slice(0, -1));
    expect(numerator?.params).toEqual([new Date(Date.parse(timestamp) - hours * 3_600_000).toISOString(), timestamp]);
    expect(data.coverage).toMatchObject({ observedTokensInWindow: 2, tokensWithStoredTransfers: 2, observationExposureVerified: false });
    expect(data.dataQuality.completeness).toBe("partial");
    expect(data.dataQuality.note).toContain("not scan completeness");
    expect(data.activity.transferEvents).toBe(30);
  });

  it.each(["1h", "6h", "24h"])("%s opt-out removes only ranking SQL and preserves nonranking output", async (window) => {
    const defaultDb = fakeDatabase();
    const explicitDb = fakeDatabase();
    const leanDb = fakeDatabase();
    const baseline = await getOverviewData(defaultDb.db, window);
    const explicit = await getOverviewData(explicitDb.db, window, { includeTopTokens: true });
    const lean = await getOverviewData(leanDb.db, window, { includeTopTokens: false });

    expect(defaultDb.calls).toHaveLength(7);
    expect(defaultDb.calls.filter((call) => !call.arrayMode)).toHaveLength(3);
    expect(explicit).toEqual(baseline);
    expect(explicitDb.calls).toEqual(defaultDb.calls);
    expect(baseline.topTokens.map(({ address, activityIndex, momentumPct }) => ({ address, activityIndex, momentumPct }))).toEqual([
      { address: "0xhigh", activityIndex: 100, momentumPct: 100 },
      { address: "0xlow", activityIndex: 50, momentumPct: 100 },
    ]);
    expect(baseline.topTokens[0].evidence).toEqual(["20 transfers across 8 addresses", "+100% transfer count versus previous window", "+2 holders at the latest snapshot"]);
    expect(baseline.activity.transferEvents).toBe(30);
    expect(baseline.timeline).toHaveLength(1);
    expect(baseline.recentTransfers[0].kind).toBe("mint");
    expect(baseline.chain?.totalBlocks).toBe(100);
    expect(baseline.coverage.completedCycles).toBe(1);

    console.log(`${window}: default=${defaultDb.calls.length} SQL, opt-out=${leanDb.calls.length} SQL`);
    expect(leanDb.calls).toHaveLength(6);
    expect(leanDb.calls.filter((call) => !call.arrayMode)).toHaveLength(2);
    expect(leanDb.calls).toEqual(defaultDb.calls.filter((call) => !call.sql.includes("WITH counts AS")));
    expect(lean).toEqual({ ...baseline, topTokens: [] });
  });

  it.each([
    ["overview", overviewGET],
    ["capital-flow", capitalFlowGET],
  ] as const)("%s opts out without changing its response data", async (endpoint, handler) => {
    const baselineDb = fakeDatabase();
    const baseline = await getOverviewData(baselineDb.db, "24h");
    const routeDb = fakeDatabase();
    vi.mocked(getDb).mockReturnValue(routeDb.db);
    const response = await handler(new Request(`http://localhost/api/v1/${endpoint}?window=24h`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ ...baseline, topTokens: [] });
    expect(body.meta.servedFrom).toBe("neon-postgres");
    console.log(`${endpoint}: ${routeDb.calls.length} SQL`);
    expect(routeDb.calls).toHaveLength(6);
    expect(routeDb.calls).toEqual(baselineDb.calls.filter((call) => !call.sql.includes("WITH counts AS")));
  });

  it("opportunities withholds page-bounded rankings while raw overview activity remains available", async () => {
    const baseline = await getOverviewData(fakeDatabase().db, "24h");
    const routeDb = fakeDatabase();
    vi.mocked(getDb).mockReturnValue(routeDb.db);
    const response = await opportunitiesGET(new Request("http://localhost/api/v1/opportunities?window=24h"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(baseline.activity.transferEvents).toBe(30);
    expect(body.meta.status).toBe("withheld");
    expect(body.data).toEqual([]);
    expect(body.meta.release.reasons).toContain("Comparable observation exposure is unverified for this window");
    expect(routeDb.calls).toHaveLength(7);
    console.log(`opportunities: ${routeDb.calls.length} SQL, ${body.data.length} ranked tokens`);
  });
});
