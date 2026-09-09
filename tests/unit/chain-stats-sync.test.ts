// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { sourceSyncState, tokenTransfers } from "@/db/schema";
import { getDb } from "@/lib/db";
import { syncChainStats } from "@/lib/jobs/sync-chain-stats";
import { fetchRpcChainSnapshot } from "@/lib/sources/rpc-chain";
import { createSourceRequester, SourceRequestError } from "@/lib/sources/source-request";

// Each DB-state scenario gets an isolated real request policy and virtual policy
// clock. HTTP budgets/cooldowns have their own integration tests; they must not
// leak across scenarios whose observation clock intentionally stays fixed.
let request: ReturnType<typeof createSourceRequester>;
vi.mock("@/lib/sources/source-request", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sources/source-request")>();
  return { ...actual, fetchSourceJson: (...args: Parameters<typeof actual.fetchSourceJson>) => request(...args) };
});

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/sources/rpc-chain", () => ({ fetchRpcChainSnapshot: vi.fn() }));
vi.mock("@/lib/config", () => ({
  getAPIs: () => ({ blockscout: { baseUrl: "https://blockscout.invalid/api/v2" } }),
}));

const oldTime = new Date("2026-09-08T00:00:00.000Z");
const now = new Date("2026-09-08T04:00:00.000Z");
const oldStats = { totalBlocks: 100, totalTransactions: 200, totalAddresses: 50, observedAt: oldTime.toISOString() };
const oldGas = { gasPricesGwei: { slow: 1, average: 2, fast: 3 }, observedAt: oldTime.toISOString() };
type State = Partial<typeof sourceSyncState.$inferSelect>;
const fetchMock = vi.fn<typeof fetch>();

// In-memory persistence only. Compile real WHERE clauses to ensure reads and
// writes target the correct source/job, without initializing any DB client.
function fakeDatabase(priorStats: State | null = { cursor: oldStats, lastSuccessAt: oldTime }) {
  const rows = new Map<string, State>([
    ["blockscout:gas-prices", { cursor: oldGas, lastSuccessAt: oldTime, status: "success" }],
    ["other-source:chain-stats", { cursor: { totalBlocks: 9999 }, lastSuccessAt: oldTime }],
  ]);
  if (priorStats) rows.set("blockscout:chain-stats", { status: "success", ...priorStats });
  const key = (condition: SQL) => new PgDialect().sqlToQuery(condition).params.join(":");
  const transferRead = vi.fn(async () => [{ block: 1000 }]);
  const readStats = vi.fn(async (condition: SQL) => {
    const row = rows.get(key(condition));
    return row ? [{ cursor: row.cursor }] : [];
  });
  const updates: { key: string; values: State }[] = [];
  const db = {
    insert: (table: unknown) => {
      expect(table).toBe(sourceSyncState);
      return {
        values: (values: State) => ({
          onConflictDoUpdate: async ({ set }: { set: State }) => {
            const id = `${values.source}:${values.jobName}`;
            const existing = rows.get(id);
            rows.set(id, existing ? { ...existing, ...set } : { ...values });
          },
        }),
      };
    },
    select: () => ({
      from: (table: unknown) => {
        // The old guard sees a transfer sample ahead of the stats endpoint.
        if (table === tokenTransfers) return transferRead();
        expect(table).toBe(sourceSyncState);
        return { where: (condition: SQL) => ({ limit: () => readStats(condition) }) };
      },
    }),
    update: (table: unknown) => {
      expect(table).toBe(sourceSyncState);
      return {
        set: (values: State) => ({
          where: async (condition: SQL) => {
            const id = key(condition);
            updates.push({ key: id, values });
            rows.set(id, { ...rows.get(id), ...values });
          },
        }),
      };
    },
  };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return { rows, updates, transferRead, readStats };
}

function respond(totalBlocks = 110, gasPrices: { slow: number | null; average: number | null; fast: number | null } | null = { slow: 4, average: 5, fast: 6 }) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({
    total_blocks: String(totalBlocks),
    total_transactions: "250",
    total_addresses: "60",
    gas_prices: gasPrices,
    gas_price_updated_at: now.toISOString(),
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(fetchRpcChainSnapshot).mockRejectedValue(new Error("rpc fallback unavailable"));
  let policyNow = now.getTime();
  request = createSourceRequester({ now: () => policyNow, wait: async (ms) => { policyNow += ms; }, random: () => 0 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("syncChainStats same-source regression guard", () => {
  it("stores a fresh RPC block and gas observation when Blockscout is blocked", async () => {
    const db = fakeDatabase();
    fetchMock.mockRejectedValue(new Error("blockscout blocked"));
    vi.mocked(fetchRpcChainSnapshot).mockResolvedValue({
      latestBlock: 58244282,
      gasPricesGwei: { slow: null, average: 0.014152608, fast: null },
      source: "rpc",
      observedAt: now.toISOString(),
    });

    await expect(syncChainStats()).resolves.toMatchObject({ totalBlocks: 58244282, source: "rpc" });
    expect(db.rows.get("blockscout:chain-stats")).toMatchObject({
      cursor: { totalBlocks: 58244282, totalTransactions: null, totalAddresses: null, source: "rpc" },
      lastSuccessAt: now,
      status: "success",
    });
    expect(db.rows.get("blockscout:gas-prices")).toMatchObject({
      cursor: { gasPricesGwei: { slow: null, average: 0.014152608, fast: null }, source: "rpc" },
      lastSuccessAt: now,
      status: "success",
    });
  });
  it("stores new aggregate progress even when the transfer sample is ahead", async () => {
    const db = fakeDatabase();
    respond();

    const result = await syncChainStats();

    expect(result).toMatchObject({ totalBlocks: 110, totalTransactions: 250, totalAddresses: 60, observedAt: now.toISOString() });
    expect(db.rows.get("blockscout:chain-stats")).toMatchObject({
      cursor: result, lastSuccessAt: now, status: "success", recordsProcessed: 1, lastError: null,
    });
    expect(db.rows.get("blockscout:chain-stats")?.cursor).not.toEqual(oldStats);
    expect(db.transferRead).not.toHaveBeenCalled();
    expect(db.rows.get("other-source:chain-stats")?.cursor).toEqual({ totalBlocks: 9999 });
  });

  it("rejects lower same-source stats without refreshing old stats, but stores fresh gas", async () => {
    const db = fakeDatabase();
    respond(99);

    expect(await syncChainStats()).toEqual({
      ignored: true, gasStored: true, reason: "Ignored regressing Blockscout stats response: 99 < 100",
    });
    expect(db.rows.get("blockscout:chain-stats")).toMatchObject({
      cursor: oldStats, lastSuccessAt: oldTime, status: "degraded", recordsProcessed: 0, lastErrorAt: now,
    });
    expect(db.updates.find((update) => update.key === "blockscout:chain-stats")?.values).not.toHaveProperty("cursor");
    expect(db.updates.find((update) => update.key === "blockscout:chain-stats")?.values).not.toHaveProperty("lastSuccessAt");
    expect(db.rows.get("blockscout:gas-prices")).toMatchObject({
      cursor: { gasPricesGwei: { slow: 4, average: 5, fast: 6 }, gasPriceUpdatedAt: now.toISOString(), observedAt: now.toISOString() },
      lastSuccessAt: now, status: "success", recordsProcessed: 1, lastError: null,
    });
  });

  it("accepts the first stats success without a same-source baseline", async () => {
    const db = fakeDatabase(null);
    respond();

    const result = await syncChainStats();

    expect(result).toMatchObject({ totalBlocks: 110 });
    expect(db.rows.get("blockscout:chain-stats")).toMatchObject({ cursor: result, lastSuccessAt: now, status: "success" });
    expect(db.transferRead).not.toHaveBeenCalled();
  });

  it("accepts an equal count and persists the new response rather than restamping old stats", async () => {
    const db = fakeDatabase();
    respond(100);

    const result = await syncChainStats();

    expect(result).toMatchObject({ totalBlocks: 100, totalTransactions: 250, totalAddresses: 60, observedAt: now.toISOString() });
    expect(db.rows.get("blockscout:chain-stats")).toMatchObject({ cursor: result, lastSuccessAt: now, status: "success" });
  });

  it.each([null, { slow: null, average: null, fast: null }])("keeps unusable gas degraded independently of accepted stats (%j)", async (gas) => {
    const db = fakeDatabase();
    respond(110, gas);

    expect(await syncChainStats()).toMatchObject({ totalBlocks: 110 });

    expect(db.rows.get("blockscout:chain-stats")).toMatchObject({ lastSuccessAt: now, status: "success" });
    expect(db.rows.get("blockscout:gas-prices")).toMatchObject({
      cursor: oldGas, lastSuccessAt: oldTime, status: "degraded", recordsProcessed: 0, lastErrorAt: now,
      lastError: "Blockscout stats response did not include a usable gas price",
    });
  });

  it.each([true, false])("preserves prior success/cursor on fetch error (prior stats: %s)", async (hasPrior) => {
    const db = fakeDatabase(hasPrior ? { cursor: oldStats, lastSuccessAt: oldTime } : null);
    const error = new SourceRequestError("network");
    fetchMock.mockRejectedValue(new Error("upstream unavailable"));

    await expect(syncChainStats()).rejects.toMatchObject({ code: "network", message: error.message });

    const stats = db.rows.get("blockscout:chain-stats");
    expect(stats).toMatchObject({ status: "error", lastError: error.message, lastErrorAt: now });
    expect(stats?.cursor).toEqual(hasPrior ? oldStats : undefined);
    expect(stats?.lastSuccessAt).toEqual(hasPrior ? oldTime : undefined);
    expect(db.rows.get("blockscout:gas-prices")).toMatchObject({
      cursor: oldGas, lastSuccessAt: oldTime, status: "error", lastError: error.message, lastErrorAt: now,
    });
    for (const update of db.updates) {
      expect(update.values).not.toHaveProperty("cursor");
      expect(update.values).not.toHaveProperty("lastSuccessAt");
    }
  });

  it("retains both cursors and success times when reading the prior stats fails", async () => {
    const db = fakeDatabase();
    const error = new Error("mock DB read failed");
    db.readStats.mockRejectedValue(error);

    await expect(syncChainStats()).rejects.toBe(error);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.rows.get("blockscout:chain-stats")).toMatchObject({ cursor: oldStats, lastSuccessAt: oldTime, status: "error", lastError: error.message });
    expect(db.rows.get("blockscout:gas-prices")).toMatchObject({ cursor: oldGas, lastSuccessAt: oldTime, status: "error", lastError: error.message });
  });
});
