import { describe, expect, it } from "vitest";
import {
  buildActivityEvidence,
  calculateActivityIndex,
  calculateMomentum,
  classifyTransfer,
  evaluateActivityLensRelease,
  normalizeTokenAmount,
  ZERO_ADDRESS,
} from "@/lib/domain/activity";

describe("onchain activity domain", () => {
  it("normalizes raw token values without floating-point scaling first", () => {
    expect(normalizeTokenAmount("1664126849033043309", 18)).toBeCloseTo(1.6641268490330433);
    expect(normalizeTokenAmount("1000", null)).toBeNull();
    expect(normalizeTokenAmount("invalid", 18)).toBeNull();
  });

  it("classifies mint and burn only from the zero address boundary", () => {
    expect(classifyTransfer(ZERO_ADDRESS, "0xabc")).toBe("mint");
    expect(classifyTransfer("0xabc", ZERO_ADDRESS)).toBe("burn");
    expect(classifyTransfer("0xabc", "0xdef")).toBe("transfer");
  });

  it("uses the documented 60/40 relative activity formula", () => {
    expect(calculateActivityIndex(100, 50, 100, 50)).toBe(100);
    expect(calculateActivityIndex(50, 25, 100, 50)).toBe(50);
  });

  it("keeps newly observed activity distinct from numeric momentum", () => {
    expect(calculateMomentum(10, 0)).toBeNull();
    expect(calculateMomentum(0, 0)).toBe(0);
    expect(calculateMomentum(150, 100)).toBe(50);
  });

  it("produces evidence from observed values", () => {
    expect(buildActivityEvidence(25, 20, 9, 3)).toEqual([
      "25 transfers across 9 addresses",
      "+25% transfer count versus previous window",
      "+3 holders at the latest snapshot",
    ]);
  });

  it("opens the limited Activity Lens only after the operational gate passes", () => {
    const now = Date.parse("2026-09-05T01:15:00.000Z");
    const ready = evaluateActivityLensRelease({
      completedCycles: 7,
      trackedTokens: 194,
      tokensWithStoredTransfers: 192,
      syncStatus: "success",
      lastIndexedAt: "2026-09-05T01:04:40.112Z",
      rankedTokens: 12,
    }, now);
    expect(ready).toMatchObject({ active: true, status: "active-limited", coveragePct: 99, reasons: [] });

    const stale = evaluateActivityLensRelease({
      completedCycles: 7,
      trackedTokens: 194,
      tokensWithStoredTransfers: 192,
      syncStatus: "error",
      lastIndexedAt: "2026-09-04T22:00:00.000Z",
      rankedTokens: 12,
    }, now);
    expect(stale.active).toBe(false);
    expect(stale.reasons).toContain("Transfer index is stale or has an invalid timestamp");
  });
});
