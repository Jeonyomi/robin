import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runActivityPulse } from "../../scripts/lib/activity-pulse";

describe("activity pulse stage isolation", () => {
  it("scheduled launcher uses the isolated runner and CLI enables durable source policy", () => {
    const cmd = readFileSync("scripts/sync-hourly.cmd", "utf8");
    expect(cmd).toContain("scripts/activity-pulse.ts");
    expect(cmd).not.toMatch(/goto done/i);
    expect(readFileSync("scripts/sync.ts", "utf8")).toContain('process.env.ROBINWATCH_COLLECTOR = "1"');
  });
  it.each(["stats", "snapshot"])("preserves failure from %s after successful transfers", async (failed) => {
    const result = await runActivityPulse(async stage => stage === failed ? 2 : 0);
    expect(result.exitCode).toBe(1); expect(result.stages).toHaveLength(3);
  });
  it("continues after executor exceptions and rejects null/signal exit results", async () => {
    const result = await runActivityPulse(async stage => {
      if (stage === "transfers") throw new Error("private source details");
      return stage === "stats" ? Number.NaN : 0;
    });
    expect(result.stages.map(x => x.exitCode)).toEqual([1, 1, 0]);
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("returns success only when every stage succeeds", async () => {
    expect((await runActivityPulse(async () => 0)).exitCode).toBe(0);
  });
  it("runs low-volume chain stats before transfer scanning and continues after failure", async () => {
    const execute = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValue(0);
    const result = await runActivityPulse(execute);
    expect(execute.mock.calls.map(([stage]) => stage)).toEqual(["stats", "transfers", "snapshot"]);
    expect(result.exitCode).toBe(1);
    expect(result.stages).toEqual([{ stage: "stats", exitCode: 0 }, { stage: "transfers", exitCode: 1 }, { stage: "snapshot", exitCode: 0 }]);
  });
});
