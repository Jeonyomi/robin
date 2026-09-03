import { describe, it, expect } from "vitest";
import { adjustReferencePrice } from "@/lib/sources/robinhood/prices";

describe("multiplier normalization (3.3 Corporate Action)", () => {
  it("divides raw mid by multiplier to get adjusted reference price", () => {
    // CRWD multiplier 4.0 — raw underlier mid must be divided to get onchain reference
    expect(adjustReferencePrice(400, "4.000000000000000000")).toBeCloseTo(100, 10);
  });

  it("returns raw mid when multiplier is 1.0", () => {
    expect(adjustReferencePrice(236.45, "1.000000000000000000")).toBeCloseTo(236.45, 10);
  });

  it("handles near-1 multipliers (AAPL 1.000566080061092436)", () => {
    const adjusted = adjustReferencePrice(250.14152, "1.000566080061092436");
    expect(adjusted).toBeLessThan(250.14152);
    expect(adjusted).toBeCloseTo(250.14152 / 1.000566080061092436, 10);
  });

  it("returns null when multiplier is missing", () => {
    expect(adjustReferencePrice(100, null)).toBeNull();
  });

  it("returns null when raw mid is null", () => {
    expect(adjustReferencePrice(null, "2.0")).toBeNull();
  });

  it("returns null for zero multiplier (should never divide by zero)", () => {
    expect(adjustReferencePrice(100, "0")).toBeNull();
  });
});
