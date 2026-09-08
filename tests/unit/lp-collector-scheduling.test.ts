import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remainingLpCooldown, persistLpCooldown } from "@/lib/sources/uniswap-v3/collector-cooldown";
import { createPacedLpFetch } from "@/lib/sources/uniswap-v3/paced-fetch";
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); vi.restoreAllMocks(); });
function stateFile() { const directory = mkdtempSync(join(tmpdir(), "lp-cooldown-test-")); directories.push(directory); return join(directory, "cooldown.json"); }

describe("dedicated LP collector scheduling", () => {
  it("persists provider cooldown across process-style reads without renewing it", () => {
    const file = stateFile(); expect(remainingLpCooldown(file, 1000)).toBe(0);
    persistLpCooldown(file, 180, 1000); const written = readFileSync(file, "utf8");
    expect(remainingLpCooldown(file, 1000)).toBe(180); expect(remainingLpCooldown(file, 61_000)).toBe(120);
    expect(readFileSync(file, "utf8")).toBe(written); expect(remainingLpCooldown(file, 181_000)).toBe(0);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });
  it("never shortens an existing provider deadline", () => {
    const file = stateFile(); persistLpCooldown(file, 180, 1000); persistLpCooldown(file, 60, 2000);
    expect(remainingLpCooldown(file, 2000)).toBe(179);
  });
  it("fails closed on corrupt state or an invalid duration", () => {
    const file = stateFile(); writeFileSync(file, '{"untilMs":"not-a-time"}');
    expect(() => remainingLpCooldown(file, 1000)).toThrow(/Invalid/);
    expect(() => persistLpCooldown(file, -1, 1000)).toThrow(/Invalid/);
  });
  it("serializes complete log requests with a separate minimum start interval", async () => {
    let active = 0, peak = 0; const starts: number[] = [];
    const send = vi.fn<typeof fetch>().mockImplementation(async () => {
      active++; peak = Math.max(peak, active); starts.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 15)); active--;
      return new Response(JSON.stringify({ result: [] }));
    });
    const paced = createPacedLpFetch(new AbortController().signal, { fetch: send, intervalMs: 1, logIntervalMs: 35, networkTimeoutMs: 200 });
    await Promise.all(Array.from({ length: 4 }, () => paced("https://example.invalid", { body: '{"method":"eth_getLogs"}' })));
    expect(peak).toBe(1); expect(send).toHaveBeenCalledTimes(4);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(30);
  });
  it("cancels serial log followers after 429 and logs only an allowed method name", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"error":{"code":429,"message":"PRIVATE"}}'));
    const paced = createPacedLpFetch(new AbortController().signal, { fetch: send, intervalMs: 1, logIntervalMs: 1 });
    const result = await Promise.allSettled(Array.from({ length: 4 }, () => paced("https://example.invalid/PRIVATE", { body: '{"method":"eth_getLogs"}' })));
    expect(result.every((item) => item.status === "rejected")).toBe(true); expect(send).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith("LP_RPC_RATE_LIMIT", '{"method":"eth_getLogs"}');
    expect(JSON.stringify(warning.mock.calls)).not.toContain("PRIVATE");
  });
});
