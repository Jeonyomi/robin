import { afterEach, beforeEach, expect, it, vi } from "vitest";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const success = (source: string, jobName: string, lastSuccessAt: string) => ({
  source, jobName, status: "success", lastSuccessAt, lastStartedAt: lastSuccessAt,
  lastError: null, cursor: null,
});

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/api-helpers", () => ({
  tryDatabase: async (fn: () => Promise<unknown>) => ({ ok: true, data: await fn() }),
}));
vi.mock("@/lib/queries", () => ({
  getSyncStatesData: async () => [
    success("robinhood", "canonical-assets", "2026-09-08T11:00:00.000Z"),
    { ...success("blockscout", "chain-stats", "2026-09-09T11:59:00.000Z"), status: "degraded", lastError: "Ignored regressing Blockscout stats response: 99 < 100" },
    success("blockscout", "gas-prices", "2026-09-09T11:59:00.000Z"),
    { ...success("blockscout", "token-transfers", "2026-09-01T00:00:00.000Z"), status: "error", lastError: "legacy failure" },
    success("rpc", "token-transfers", "2026-09-09T11:59:00.000Z"),
  ],
}));
vi.mock("@/lib/snapshot", () => ({ loadSnapshot: async () => null }));
vi.mock("@/lib/sources/uniswap-v3/snapshot-store", () => ({
  readStoredLpSnapshot: async () => ({
    data: { observedAt: "2026-09-09T11:59:00.000Z" },
    collector: {
      publishedAt: "2026-09-09T11:59:10.000Z",
      lastAttemptAt: "2026-09-09T11:59:30.000Z",
      lastAttemptOk: false,
      lastError: "rate-limit",
    },
  }),
}));
vi.mock("@/lib/lp-leaders", () => ({
  LP_LEADER_FRESH_MS: 300_000,
  isFreshLeaderboard: (data: { observedAt: string }, now: number) => now - Date.parse(data.observedAt) <= 300_000,
}));

beforeEach(() => vi.setSystemTime(NOW));
afterEach(() => vi.useRealTimers());

it("aligns canonical health with daily maintenance cadence", async () => {
  const { GET } = await import("../../src/app/api/v1/source-health/route");
  const body = await (await GET()).json();
  expect(body.data.sources).toContainEqual(expect.objectContaining({
    name: "Robinhood Assets API", role: "active", status: "healthy",
  }));
});

it("keeps fresh accepted chain stats operational when a lower provider sample is rejected", async () => {
  const { GET } = await import("../../src/app/api/v1/source-health/route");
  const body = await (await GET()).json();
  expect(body.data.sources).toContainEqual(expect.objectContaining({
    name: "Blockscout Chain Stats", role: "active", status: "healthy",
    warning: "Latest collector attempt was rejected because the provider aggregate regressed.",
  }));
  expect(body.data.overallStatus).toBe("healthy");
});

it("keeps the retired Blockscout transfer path visible without degrading active operations", async () => {
  const { GET } = await import("../../src/app/api/v1/source-health/route");
  const body = await (await GET()).json();
  expect(body.data.sources).toContainEqual(expect.objectContaining({
    name: "Legacy Blockscout Token Transfers", role: "legacy", status: "degraded",
  }));
  expect(body.data.overallStatus).toBe("healthy");
});

it("reports a failed LP attempt as a warning while its verified snapshot remains usable", async () => {
  const { GET } = await import("../../src/app/api/v1/source-health/route");
  const body = await (await GET()).json();
  expect(body.data.sources).toContainEqual(expect.objectContaining({
    name: "Uniswap V3 LP Snapshot", role: "active", status: "healthy", usable: true,
    lastAttemptOk: false, warning: "Latest LP collector attempt failed (rate-limit).",
  }));
  expect(body.data.overallStatus).toBe("healthy");
});
