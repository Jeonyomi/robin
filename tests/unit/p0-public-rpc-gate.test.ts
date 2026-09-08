import { describe, it, expect, vi } from "vitest";
import { createPublicRpcGate } from "@/lib/sources/public-rpc-gate";

describe("shared instance public RPC admission", () => {
  it("expires cached evidence and never substitutes it after a failed refresh", async () => {
    let now = 10_000;
    const gate = createPublicRpcGate(() => now);
    let acceptable = true;
    const load = vi.fn().mockResolvedValueOnce("observation").mockRejectedValueOnce(new Error("unavailable"));
    expect(await gate.run("lp:1", load, { cost: 17, accept: () => acceptable })).toBe("observation");
    now += 3_000; acceptable = false;
    await expect(gate.run("lp:1", load, { cost: 17, accept: () => acceptable })).rejects.toThrow("unavailable");
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("bounds total daily method estimates and resets on a new UTC day", async () => {
    let now = 0;
    const gate = createPublicRpcGate(() => now);
    const load = vi.fn().mockResolvedValue("fresh");
    for (let i = 0; i < Math.floor(10_000 / 192); i++) {
      await gate.run(`pool:${i}`, load, { cost: 192 }); now += 61_000;
    }
    await expect(gate.run("excess", load, { cost: 192 })).rejects.toMatchObject({ retryAfterSeconds: expect.any(Number) });
    now = 86_400_000;
    expect(await gate.run("new-day", load, { cost: 192 })).toBe("fresh");
  });
  it("refuses invalid method estimates without upstream work", async () => {
    const gate = createPublicRpcGate(); const load = vi.fn();
    for (const cost of [-1, 0, 0.5, 193, NaN, Infinity]) await expect(gate.run("invalid", load, { cost })).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
  });
  it("shares concurrency, cooldown and estimated method budgets between routes", async () => {
    let now = 1_000;
    const gate = createPublicRpcGate(() => now);
    let finish!: (value: string) => void;
    const first = gate.run("meme:pool", () => new Promise<string>(r => { finish = r; }), { cost: 96 });
    await Promise.resolve();
    const blocked = vi.fn(async () => "not allowed");
    await expect(gate.run("legacy:2", blocked, { cost: 17 })).rejects.toMatchObject({ retryAfterSeconds: expect.any(Number) });
    expect(blocked).not.toHaveBeenCalled(); finish("ok"); await first;
    now += 2_001;
    await gate.run("meme:other", async () => "ok", { cost: 96 });
    now += 2_001;
    await expect(gate.run("legacy:2", blocked, { cost: 17 })).rejects.toThrow(/budget|cooling/i);
    now += 60_001;
    await expect(gate.run("legacy:failure", async () => { throw new Error("private"); }, { cost: 17 })).rejects.toThrow("private");
    now += 2_001;
    await expect(gate.run("legacy:2", blocked, { cost: 17 })).rejects.toThrow(/cooling/i);
    expect(blocked).not.toHaveBeenCalled();
  });
  it("coalesces repeated legacy token requests and caches only successful results", async () => {
    let now = 1_000;
    const gate = createPublicRpcGate(() => now);
    let resolve!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    const first = gate.run("legacy:1", load, { cost: 17 });
    const second = gate.run("legacy:1", load, { cost: 17 });
    await Promise.resolve(); resolve("verified");
    expect(await first).toBe("verified"); expect(await second).toBe("verified");
    expect(await gate.run("legacy:1", load, { cost: 17 })).toBe("verified");
    expect(load).toHaveBeenCalledTimes(1);
    now += 31_000;
    expect(await gate.run("legacy:1", async () => "new", { cost: 17 })).toBe("new");
  });
});
