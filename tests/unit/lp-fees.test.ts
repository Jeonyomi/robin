import { describe, expect, it } from "vitest";
import { feeGrowthInside, inventoryAtPrice, pendingFee, reconcileFeeLedger, type FeeEvent } from "@/lib/domain/lp/fees";

const B = BigInt;
const Q96 = B(2) ** B(96);
const Q128 = B(2) ** B(128);
const Q256 = B(2) ** B(256);
function event(kind: FeeEvent["kind"], liquidity: number, amount0 = 0, amount1 = 0, block = 1, logIndex = 0): FeeEvent {
  return { kind, liquidity: B(liquidity), amount0: B(amount0), amount1: B(amount1), blockNumber: B(block), logIndex };
}
function ledger(events = [event("increase", 100, 200, 300)], overrides: Partial<Parameters<typeof reconcileFeeLedger>[0]> = {}) {
  return reconcileFeeLedger({ events, mintBlock: B(1), liquidity: B(100), tokensOwed0: B(0), tokensOwed1: B(0), pending0: B(0), pending1: B(0), ...overrides });
}

describe("v3 fee growth (synthetic arithmetic fixtures)", () => {
  it.each([[-11, 10], [-10, 70], [0, 70], [9, 70], [10, -10], [11, -10]])("uses half-open tick range at %i", (tick, expected) => {
    expect(feeGrowthInside(B(100), B(20), B(10), tick, -10, 10)).toBe((B(expected) + Q256) % Q256);
  });
  it("wraps uint256 growth and floors Q128 multiplication", () => {
    expect(feeGrowthInside(B(2), Q256 - B(3), B(1), 0, -1, 1)).toBe(B(4));
    expect(pendingFee(B(2), Q256 - B(3), Q128 - B(1))).toBe(B(4));
    expect(pendingFee(Q128 / B(3), B(0), B(3))).toBe(B(0));
    expect(pendingFee(Q128, B(0), B(17))).toBe(B(17));
    expect(pendingFee(B(0), B(0), B(0))).toBe(B(0));
  });
  it("rejects malformed, out-of-range and overflowed growth", () => {
    for (const bad of [B(-1), Q256, undefined, null, 1]) {
      expect(() => pendingFee(bad as bigint, B(0), B(1))).toThrow();
      expect(() => feeGrowthInside(B(0), bad as bigint, B(0), 0, -1, 1)).toThrow();
    }
    expect(() => pendingFee(Q256 - B(1), B(0), Q128 - B(1))).toThrow();
    expect(() => pendingFee(B(0), B(0), Q128)).toThrow();
    expect(() => feeGrowthInside(B(0), B(0), B(0), NaN, -1, 1)).toThrow();
    expect(() => feeGrowthInside(B(0), B(0), B(0), 0, 1, 1)).toThrow();
  });
});

describe("lifetime recorded fee entitlement across all owners", () => {
  it("subtracts uncollected withdrawn principal already in tokensOwed", () => {
    const result = ledger([event("increase", 100, 200, 300), event("decrease", 40, 80, 120, 2)], {
      liquidity: B(60), tokensOwed0: B(87), tokensOwed1: B(129), pending0: B(3), pending1: B(2),
    });
    expect(result).toEqual({ fees0: B(10), fees1: B(11), deposited0: B(200), deposited1: B(300), withdrawn0: B(80), withdrawn1: B(120), collected0: B(0), collected1: B(0), increaseCount: 1, decreaseCount: 1, collectCount: 0 });
  });
  it("collect principal is not fees; supports multiple adds/removes and transfer gaps", () => {
    // Transfers do not appear in this position-wide ledger, and must not reset it.
    const events = [event("increase", 100, 200, 300), event("decrease", 40, 80, 120, 2), event("collect", 0, 85, 126, 2, 1), event("increase", 20, 40, 60, 8), event("decrease", 80, 160, 240, 9), event("collect", 0, 160, 242, 10)];
    const shuffled = events.toReversed();
    const copy = [...shuffled];
    const result = ledger(shuffled, { liquidity: B(0) });
    expect(shuffled).toEqual(copy);
    expect(result).toMatchObject({ fees0: B(5), fees1: B(8), deposited0: B(240), withdrawn0: B(240), collected0: B(245), increaseCount: 2, decreaseCount: 2, collectCount: 2 });
  });
  it("distinguishes known zero from unknown, missing and inconsistent observations", () => {
    expect(ledger().fees0).toBe(B(0));
    for (const key of ["liquidity", "tokensOwed0", "tokensOwed1", "pending0", "pending1", "mintBlock"] as const) {
      expect(() => ledger(undefined, { [key]: undefined })).toThrow();
      expect(() => ledger(undefined, { [key]: B(-1) })).toThrow();
    }
    expect(() => ledger([])).toThrow();
    expect(() => ledger(undefined, { liquidity: B(99) })).toThrow();
    expect(() => ledger(undefined, { tokensOwed0: Q128 })).toThrow();
    expect(() => ledger([event("increase", 100), event("decrease", 10, 1, 0, 2)], { liquidity: B(90) })).toThrow();
  });
  it("rejects duplicate coordinates, pre-mint/missing mint and impossible balances", () => {
    for (const events of [
      [event("increase", 100), event("collect", 0)],
      [event("increase", 100, 0, 0, 0)],
      [event("increase", 100, 0, 0, 2)],
      [event("collect", 0), event("increase", 100, 0, 0, 2)],
      [event("increase", 100), event("decrease", 101, 0, 0, 2), event("increase", 101, 0, 0, 3)],
    ]) expect(() => ledger(events)).toThrow();
  });
  it.each([
    { liquidity: B(0) }, { liquidity: B(-1) }, { liquidity: Q128 }, { amount0: B(-1) }, { amount1: B(-1) }, { amount0: Q256 }, { amount1: undefined }, { logIndex: -1 }, { logIndex: 0.5 }, { logIndex: NaN }, { blockNumber: B(-1) }, { kind: "transfer" },
  ])("rejects malformed event %o", (bad) => {
    expect(() => ledger([{ ...event("increase", 100), ...bad } as FeeEvent])).toThrow();
  });
  it("requires zero collect liquidity and positive decrease liquidity", () => {
    expect(() => ledger([event("increase", 100), event("collect", 1, 0, 0, 2)])).toThrow();
    expect(() => ledger([event("increase", 100), event("decrease", 0, 0, 0, 2)])).toThrow();
  });
});

describe("approximate v3 inventory in human token units", () => {
  it("matches independent p=1 reference with bounds approximately 0.25..4", () => {
    const tick = Math.round(Math.log(4) / Math.log(1.0001));
    const upper = Math.sqrt(Math.pow(1.0001, tick));
    const lower = Math.sqrt(Math.pow(1.0001, -tick));
    const actual = inventoryAtPrice(B(1000), Q96, -tick, tick, 0, 0);
    expect(actual.amount0).toBeCloseTo(1000 * (upper - 1) / upper, 9);
    expect(actual.amount1).toBeCloseTo(1000 * (1 - lower), 9);
  });
  it("handles below/above range, boundaries and decimal scaling", () => {
    expect(inventoryAtPrice(B(1000), Q96 / B(2), 0, 100, 0, 0).amount1).toBe(0);
    expect(inventoryAtPrice(B(1000), Q96, 0, 100, 0, 0).amount1).toBe(0);
    expect(inventoryAtPrice(B(1000), Q96, -100, 0, 0, 0).amount0).toBe(0);
    expect(inventoryAtPrice(B(1000), Q96 * B(2), -100, 0, 0, 0).amount0).toBe(0);
    const raw = inventoryAtPrice(B(1000), Q96, -100, 100, 0, 0);
    const scaled = inventoryAtPrice(B(1000), Q96, -100, 100, 6, 18);
    expect(scaled.amount0).toBeCloseTo(raw.amount0 / 1e6, 15);
    expect(scaled.amount1 / (raw.amount1 / 1e18)).toBeCloseTo(1, 14);
  });
  it("retains tiny nonzero amounts at narrow boundaries", () => {
    const above = inventoryAtPrice(B(1), Q96 + B(1), 0, 1, 36, 36);
    expect(above.amount1).toBeGreaterThan(0);
    expect(above.amount1 / (1 / Number(Q96) / 1e36)).toBeCloseTo(1, 14);
    expect(inventoryAtPrice(B(1), Q96 - B(1), -1, 0, 36, 36).amount0).toBeGreaterThan(0);
  });
  it.each([[-887272, 887272], [-1, 1], [887271, 887272], [-887272, -887271]])("is finite for wide/extreme/narrow ticks %i..%i", (lower, upper) => {
    const amounts = inventoryAtPrice(Q128 - B(1), Q96, lower, upper, 0, 36);
    for (const amount of Object.values(amounts)) { expect(Number.isFinite(amount)).toBe(true); expect(amount).toBeGreaterThanOrEqual(0); }
  });
  it("returns known zero for zero liquidity but still validates inputs", () => {
    expect(inventoryAtPrice(B(0), Q96, -1, 1, 18, 18)).toEqual({ amount0: 0, amount1: 0 });
    const base = [B(1), Q96, -1, 1, 18, 18] as const;
    for (const [index, bad] of [[0, B(-1)], [0, Q128], [1, B(0)], [1, B(-1)], [1, Infinity], [1, B(2) ** B(2000)], [2, -887273], [3, 887273], [2, 0.5], [2, NaN], [3, -1], [4, -1], [5, 37], [4, 1.5], [5, Infinity]] as const) {
      const args: unknown[] = [...base]; args[index] = bad;
      expect(() => inventoryAtPrice(...args as unknown as Parameters<typeof inventoryAtPrice>)).toThrow();
    }
  });
});
