import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runActivityPulse } from "../../scripts/lib/activity-pulse";

const jobs = vi.hoisted(() => ({
  canonical: vi.fn(), stats: vi.fn(), metadata: vi.fn(), prices: vi.fn(),
  transfers: vi.fn(), legacyTransfers: vi.fn(), metrics: vi.fn(), actions: vi.fn(), signals: vi.fn(), snapshot: vi.fn(),
}));
vi.mock("dotenv/config", () => ({}));
vi.mock("@/lib/jobs/sync-canonical-assets", () => ({ syncCanonicalAssets: jobs.canonical }));
vi.mock("@/lib/jobs/sync-chain-stats", () => ({ syncChainStats: jobs.stats }));
vi.mock("@/lib/jobs/sync-token-metadata", () => ({ syncTokenMetadata: jobs.metadata }));
vi.mock("@/lib/jobs/sync-reference-prices", () => ({ syncReferencePrices: jobs.prices }));
vi.mock("@/lib/jobs/sync-token-transfers", () => ({ syncTokenTransfers: jobs.legacyTransfers }));
vi.mock("@/lib/jobs/sync-rpc-transfers", () => ({ syncRpcTransfers: jobs.transfers }));
vi.mock("@/lib/jobs/calculate-metrics", () => ({ calculateTokenMetrics: jobs.metrics }));
vi.mock("@/lib/jobs/generate-economic-actions", () => ({ generateEconomicActions: jobs.actions }));
vi.mock("@/lib/jobs/generate-signals", () => ({ generateSignals: jobs.signals }));
vi.mock("../../scripts/lib/snapshot-builder", () => ({
  publishSnapshotToBlob: jobs.snapshot, formatBytes: (n: number) => `${n} B`,
}));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
async function dispatch(command: string) {
  vi.resetModules();
  process.argv = ["node", "scripts/sync.ts", command];
  process.exitCode = 0;
  await import("../../scripts/sync");
  // The actual CLI starts main at module evaluation; drain its async job chain.
  await new Promise<void>(resolve => setImmediate(resolve));
  return Number(process.exitCode ?? 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const job of Object.values(jobs)) job.mockReset().mockResolvedValue({});
  jobs.snapshot.mockResolvedValue({ url: "https://offline.invalid/snapshot", sizeBytes: 10 });
  vi.stubEnv("ALLOW_SYNTHETIC_ACTIONS", "false");
  vi.stubEnv("ROBINWATCH_COLLECTOR", "0"); // Restore the CLI's direct env write after each offline scenario.
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "offline-test-token");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("real sync CLI resolved source outcomes (offline I/O boundaries)", () => {
  it("uses RPC transfers by default and legacy only with explicit operator command", async () => {
    expect(await dispatch("transfers")).toBe(0);
    expect(jobs.transfers).toHaveBeenCalledOnce();
    expect(jobs.legacyTransfers).not.toHaveBeenCalled();
    jobs.legacyTransfers.mockResolvedValue({ tokensSucceeded: 0, tokensFailed: 1 });
    expect(await dispatch("transfers-blockscout")).toBe(1);
    expect(jobs.legacyTransfers).toHaveBeenCalledOnce();
    expect(jobs.transfers).toHaveBeenCalledOnce();
  });
  it("dispatches snapshot to the publisher", async () => {
    expect(await dispatch("snapshot")).toBe(0);
    expect(jobs.snapshot).toHaveBeenCalledOnce();
  });
  it("propagates publisher rejection", async () => {
    jobs.snapshot.mockRejectedValue(new Error("offline publication failure"));
    expect(await dispatch("snapshot")).toBe(1);
    expect(jobs.snapshot).toHaveBeenCalledOnce();
  });
  it("pulse runs real CLI stages after partial persistence and retains aggregate failure", async () => {
    const persisted: string[] = [];
    jobs.transfers.mockImplementation(async () => {
      persisted.push("successful-token");
      return { tokensSucceeded: 1, tokensFailed: 1, tokensSkipped: 0 };
    });
    jobs.snapshot.mockImplementation(async () => {
      expect(persisted).toEqual(["successful-token"]);
      return { url: "https://offline.invalid/snapshot", sizeBytes: 10 };
    });
    const result = await runActivityPulse(dispatch);
    expect(result).toEqual({ stages: [
      { stage: "transfers", exitCode: 1 }, { stage: "stats", exitCode: 0 },
      { stage: "snapshot", exitCode: 0 },
    ], exitCode: 1 });
    expect(jobs.stats).toHaveBeenCalledOnce();
    expect(jobs.snapshot).toHaveBeenCalledOnce();
    expect(persisted).toEqual(["successful-token"]);
  });
  it("all publishes partial data while retaining a failed source exit", async () => {
    jobs.prices.mockResolvedValue({ processed: 2, stored: 1, errors: 1 });
    expect(await dispatch("all")).toBe(1);
    expect(jobs.metrics).toHaveBeenCalledOnce();
    expect(jobs.snapshot).toHaveBeenCalledOnce();
    expect(jobs.actions).not.toHaveBeenCalled();
    expect(jobs.signals).not.toHaveBeenCalled();
  });
  it("all attempts publication even after a thrown source failure", async () => {
    jobs.transfers.mockRejectedValue(new Error("offline source failure"));
    expect(await dispatch("all")).toBe(1);
    expect(jobs.metrics).toHaveBeenCalledOnce();
    expect(jobs.snapshot).toHaveBeenCalledOnce();
  });
  it("all propagates publication failure after healthy sources", async () => {
    jobs.snapshot.mockRejectedValue(new Error("offline publication failure"));
    expect(await dispatch("all")).toBe(1);
    expect(jobs.snapshot).toHaveBeenCalledOnce();
  });
  it("all skips publication without a Blob token", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(await dispatch("all")).toBe(0);
    expect(jobs.snapshot).not.toHaveBeenCalled();
  });
  it("watch never uploads, including subsequent intervals", async () => {
    let tick: (() => Promise<void>) | undefined;
    vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: () => Promise<void>) => {
      tick = callback;
      return 1;
    }) as unknown as typeof setInterval);
    expect(await dispatch("watch")).toBe(0);
    await tick!();
    expect(jobs.transfers).toHaveBeenCalledTimes(2);
    expect(jobs.snapshot).not.toHaveBeenCalled();
    expect(jobs.actions).not.toHaveBeenCalled();
  });
  it("explicit synthetic actions fail closed", async () => {
    expect(await dispatch("actions")).toBe(1);
    expect(jobs.actions).not.toHaveBeenCalled();
  });
  it.each([
    ["canonical", { processed: 2, created: 1, updated: 1, collisions: 1 }],
    ["transfers", { tokensSucceeded: 1, tokensFailed: 0, tokensSkipped: 0 }],
    ["metadata", { processed: 1, enriched: 1, errors: 0 }],
    ["prices", { processed: 1, stored: 1, errors: 0 }],
  ] as const)("accepts healthy %s result without treating collisions as errors", async (command, result) => {
    jobs[command].mockResolvedValue(result);
    expect(await dispatch(command)).toBe(0);
  });
  it.each([
    ["metadata", { processed: 0, enriched: 0, errors: 0 }],
    ["prices", { processed: 0, stored: 0, errors: 0 }],
    ["transfers", { tokensSucceeded: 0, tokensFailed: 0, tokensSkipped: 0 }],
    ["canonical", { processed: 0, created: 0, updated: 0, collisions: 0 }],
    ["transfers", { tokensSucceeded: 1, tokensFailed: 1, tokensSkipped: 0 }],
    ["transfers", { tokensSucceeded: 0, tokensFailed: 0, tokensSkipped: 2 }],
    ["metadata", { processed: 2, enriched: 1, errors: 1 }],
    ["prices", { processed: 2, stored: 1, errors: 1 }],
    ["stats", { ignored: true, gasStored: true, reason: "counter regression" }],
  ] as const)("returns failure for resolved %s degradation: %j", async (command, result) => {
    jobs[command].mockResolvedValue(result);
    expect(await dispatch(command)).toBe(1);
    expect(jobs[command]).toHaveBeenCalledOnce();
  });
});
