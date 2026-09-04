import { describe, expect, it } from "vitest";
import {
  buildActivityEvidence,
  calculateActivityIndex,
  calculateMomentum,
  classifyTransfer,
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
});
