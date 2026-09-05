import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  analyzePosition,
  PositionInputSchema,
  WorkspaceSchema,
  type PositionInput,
} from "@/lib/domain/lp";

// Explicit hypothetical inputs, not observations of a wallet, pool, or market.
const baseline: PositionInput = {
  id: "scenario-1",
  label: "Manual scenario",
  baseSymbol: "BASE",
  quoteSymbol: "QUOTE",
  entryPrice: 1,
  currentPrice: 1,
  lowerPrice: 0.25,
  upperPrice: 4,
  capitalQuote: 100,
  feesQuote: null,
  costsQuote: null,
  elapsedDays: null,
  observedAt: "2026-01-01T12:00:00.000Z",
};

function position(overrides: Partial<PositionInput> = {}): PositionInput {
  return { ...baseline, ...overrides };
}

function expectRelative(actual: number, expected: number, precision = 12) {
  // Unlike absolute decimal tolerances, this detects errors in very tiny losses.
  expect(actual / expected).toBeCloseTo(1, precision);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PositionInputSchema — bounded manual inputs", () => {
  it("trims display text, preserves identifiers, and strips unknown fields", () => {
    expect(PositionInputSchema.parse({
      ...baseline,
      label: "  Manual scenario  ",
      baseSymbol: " BASE ",
      quoteSymbol: " QUOTE ",
      walletBalance: 123,
    })).toEqual(baseline);
    expect(PositionInputSchema.parse(position({ id: " id " })).id).toBe(" id ");
  });

  it("accepts the specified text limits", () => {
    expect(PositionInputSchema.safeParse(position({
      id: "x".repeat(80), label: "x".repeat(60),
      baseSymbol: "x".repeat(16), quoteSymbol: "x".repeat(16),
    })).success).toBe(true);
  });

  it.each([
    { id: "x".repeat(81) }, { label: " " }, { label: "x".repeat(61) },
    { baseSymbol: " " }, { baseSymbol: "x".repeat(17) },
    { quoteSymbol: " " }, { quoteSymbol: "x".repeat(17) },
  ])("rejects malformed text %j", (overrides) => {
    expect(PositionInputSchema.safeParse(position(overrides)).success).toBe(false);
  });

  const numericFields = [
    "entryPrice", "currentPrice", "lowerPrice", "upperPrice", "capitalQuote",
    "feesQuote", "costsQuote", "elapsedDays",
  ] as const;

  it.each(numericFields)("rejects nonfinite, unbounded, and nonnumeric %s", (field) => {
    for (const invalid of [NaN, Infinity, -Infinity, Number.MAX_VALUE, 1e101, -1, "1", "", undefined]) {
      expect(PositionInputSchema.safeParse({ ...baseline, [field]: invalid }).success,
        `${field}=${String(invalid)}`).toBe(false);
    }
  });

  it.each(["entryPrice", "currentPrice", "lowerPrice", "upperPrice", "capitalQuote"] as const)(
    "rejects zero, null and underflow-scale %s", (field) => {
      for (const invalid of [0, -0, null, Number.MIN_VALUE, 1e-101]) {
        expect(PositionInputSchema.safeParse({ ...baseline, [field]: invalid }).success).toBe(false);
      }
    },
  );

  it("requires explicit nullable fields rather than filling missing fees, costs, or days", () => {
    expect(PositionInputSchema.parse(baseline)).toEqual(baseline);
    for (const key of ["feesQuote", "costsQuote", "elapsedDays"] as const) {
      const incomplete = { ...baseline } as Partial<PositionInput>;
      delete incomplete[key];
      expect(PositionInputSchema.safeParse(incomplete).success).toBe(false);
    }
    expect(PositionInputSchema.safeParse(position({ feesQuote: 0, costsQuote: 0 })).success).toBe(true);
  });

  it.each([
    { lowerPrice: 4, upperPrice: 0.25 },
    { lowerPrice: 1, upperPrice: 1 },
    { entryPrice: 0.25 }, { entryPrice: 4 },
    { entryPrice: 0.1 }, { entryPrice: 5 },
    // No representable interior price remains after rounding.
    { lowerPrice: 1, entryPrice: 1 + Number.EPSILON / 2, upperPrice: 1 + Number.EPSILON },
  ])("rejects invalid/unsupported entry ranges %j", (overrides) => {
    expect(PositionInputSchema.safeParse(position(overrides)).success).toBe(false);
  });

  it("allows positive sub-day observations but caps durations at 36,500 days", () => {
    for (const elapsedDays of [1e-9, 0.5, 1, 36500]) {
      expect(PositionInputSchema.safeParse(position({ elapsedDays })).success).toBe(true);
    }
    for (const elapsedDays of [0, -0, Number.MIN_VALUE, 1e-101, 36500.1]) {
      expect(PositionInputSchema.safeParse(position({ elapsedDays })).success).toBe(false);
    }
  });

  it.each(["feesQuote", "costsQuote"] as const)("rejects numerically unsupported nonzero %s", (field) => {
    for (const invalid of [Number.MIN_VALUE, 1e-101]) {
      expect(PositionInputSchema.safeParse({ ...baseline, [field]: invalid }).success).toBe(false);
    }
  });

  it.each(["", "not-a-date", "2026-01-01", "2026-02-30T12:00:00Z", "2026-01-01T12:00:00", "2026-01-01T25:00:00Z"])(
    "rejects an invalid or timezone-less observation %s", (observedAt) => {
      expect(PositionInputSchema.safeParse(position({ observedAt })).success).toBe(false);
    },
  );

  it("validates ISO timezone offsets but leaves freshness/future policy to the caller's clock", () => {
    vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("No clock in the domain engine"); });
    for (const observedAt of ["2000-01-01T00:00:00Z", "9999-12-31T23:59:59Z", "2026-01-01T12:00:00+09:00"]) {
      expect(PositionInputSchema.parse(position({ observedAt })).observedAt).toBe(observedAt);
    }
  });
});

describe("analyzePosition — unchanged-range v3 scenario, not wallet accounting", () => {
  it("matches an independent exact-square reference at entry", () => {
    // sqrt bounds = 1/2, 2; x/L = y/L = 1/2, so capital 100 buys L=100.
    expect(analyzePosition(baseline)).toEqual({
      liquidity: 100, entryBase: 50, entryQuote: 50,
      currentBase: 50, currentQuote: 50,
      lpValueQuote: 100, holdValueQuote: 100,
      divergenceQuote: 0, divergencePct: 0,
      feesAprPct: null, netVsHoldQuote: null, netPnlQuote: null,
      rangeState: "in-range", rangeProgressPct: 20,
      nearestEdgePct: 75, narrowRange: false,
    });
  });

  it("at the upper edge holds only quote and reports concentrated, not full-range divergence", () => {
    const result = analyzePosition(position({ currentPrice: 4 }));
    expect(result.currentBase).toBe(0);
    expect(result.currentQuote).toBe(150);
    expect(result.lpValueQuote).toBe(150);
    expect(result.holdValueQuote).toBe(250);
    expect(result.divergenceQuote).toBe(-100);
    expect(result.divergencePct).toBe(-40);
    expect(result.rangeState).toBe("above-range");
    expect(result.rangeProgressPct).toBe(100);
    expect(result.nearestEdgePct).toBe(0);
  });

  it("counts the lower boundary as in-range with only base inventory", () => {
    const result = analyzePosition(position({ currentPrice: 0.25 }));
    expect(result.currentBase).toBe(150);
    expect(result.currentQuote).toBe(0);
    expect(result.lpValueQuote).toBe(37.5);
    expect(result.holdValueQuote).toBe(62.5);
    expect(result.divergenceQuote).toBe(-25);
    expect(result.divergencePct).toBe(-40);
    expect(result.rangeState).toBe("in-range");
    expect(result.rangeProgressPct).toBe(0);
    expect(result.nearestEdgePct).toBe(0);
  });

  it.each([
    { currentPrice: 0.1, state: "below-range", base: 150, quote: 0, lp: 15, hold: 55, divergence: -40, progress: 0, edge: 150 },
    { currentPrice: 9, state: "above-range", base: 0, quote: 150, lp: 150, hold: 500, divergence: -350, progress: 100, edge: 500 / 9 },
  ])("clamps inventory, not the valuation price, outside at $currentPrice", (ref) => {
    const result = analyzePosition(position({ currentPrice: ref.currentPrice }));
    expect(result.currentBase).toBeCloseTo(ref.base, 12);
    expect(result.currentQuote).toBeCloseTo(ref.quote, 12);
    expect(result.lpValueQuote).toBeCloseTo(ref.lp, 12);
    expect(result.holdValueQuote).toBeCloseTo(ref.hold, 12);
    expect(result.divergenceQuote).toBeCloseTo(ref.divergence, 12);
    expect(result.rangeState).toBe(ref.state);
    expect(result.rangeProgressPct).toBe(ref.progress);
    expect(result.nearestEdgePct).toBeCloseTo(ref.edge, 12);
  });

  it("matches an asymmetric exact-square range reference without assuming a 50/50 deposit", () => {
    // a=1, entry sqrt=2, b=5: x/L=3/10, y/L=1. Capital=220 => L=100.
    const result = analyzePosition(position({ lowerPrice: 1, entryPrice: 4, upperPrice: 25, currentPrice: 9, capitalQuote: 220 }));
    expect(result.liquidity).toBeCloseTo(100, 12);
    expect(result.entryBase).toBeCloseTo(30, 12);
    expect(result.entryQuote).toBeCloseTo(100, 12);
    expect(result.currentBase).toBeCloseTo(40 / 3, 12);
    expect(result.currentQuote).toBeCloseTo(200, 12);
    expect(result.lpValueQuote).toBeCloseTo(320, 12);
    expect(result.holdValueQuote).toBeCloseTo(370, 12);
    expect(result.divergenceQuote).toBeCloseTo(-50, 12);
    expect(result.divergencePct).toBeCloseTo(-5000 / 370, 12);
    expect(result.rangeProgressPct).toBeCloseTo(100 / 3, 12);
    expect(result.nearestEdgePct).toBeCloseTo(800 / 9, 12);
  });

  it("matches an independent high-precision reference for a very wide range", () => {
    // Python Decimal (100-digit precision), evaluated from the input IEEE doubles.
    const result = analyzePosition(position({ lowerPrice: 1e-12, upperPrice: 1e12, currentPrice: 100 }));
    expectRelative(result.liquidity, 50.00005000005000005);
    expectRelative(result.lpValueQuote, 999.99594999594999595);
    expectRelative(result.holdValueQuote, 5050);
    expectRelative(result.divergenceQuote, -4050.00405000405000405);
    expectRelative(result.divergencePct, -80.1981000000801981);
    expect(result.narrowRange).toBe(false);
  });

  it("uses rationalized differences for a narrow range and preserves tiny divergence", () => {
    // Independent 100-digit Decimal reference; direct sqrt subtraction loses precision.
    const result = analyzePosition(position({ lowerPrice: 0.999999999999, upperPrice: 1.000000000001, currentPrice: 1.0000000000005 }));
    expectRelative(result.liquidity, 99996661168395.718845);
    expectRelative(result.entryBase, 50.002775464865367608);
    expectRelative(result.entryQuote, 49.997224535134632392);
    expectRelative(result.currentBase, 25.00138773242330745);
    expectRelative(result.currentQuote, 74.998612267582943452);
    expectRelative(result.divergenceQuote, -6.25090259259348335e-12);
    expect(result.narrowRange).toBe(true);
  });

  it("supports representable price differences even when rounded square roots coincide", () => {
    const result = analyzePosition(position({ lowerPrice: 1, entryPrice: 1.0000000000000002, upperPrice: 1.0000000000000004, currentPrice: 1.0000000000000004 }));
    expectRelative(result.liquidity, 450359962737049675);
    expectRelative(result.entryBase, 49.999999999999983347);
    expectRelative(result.entryQuote, 50.000000000000005551);
    expectRelative(result.divergenceQuote, -5.55111512312578116e-15);
    expect(result.currentBase).toBe(0);
    expect(result.rangeState).toBe("above-range");
  });

  it.each([
    { lowerPrice: 100, entryPrice: 105, upperPrice: 110, narrow: true },
    { lowerPrice: 1, entryPrice: 1.05, upperPrice: 1.1, narrow: true },
    { lowerPrice: 100, entryPrice: 105, upperPrice: 110.001, narrow: false },
    { lowerPrice: 100, entryPrice: 102, upperPrice: 105, narrow: true },
  ])("classifies narrow range by the 10% price-ratio threshold: $upperPrice/$lowerPrice", ({ narrow, ...overrides }) => {
    expect(analyzePosition(position(overrides)).narrowRange).toBe(narrow);
  });

  it.each([0.1, 0.25, 0.5, 1, 2, 4, 10])("keeps the no-fee LP/hold identities at current price %s", (currentPrice) => {
    const input = position({ currentPrice });
    const result = analyzePosition(input);
    expect(result.entryBase * input.entryPrice + result.entryQuote).toBeCloseTo(input.capitalQuote, 10);
    expect(result.currentBase * currentPrice + result.currentQuote).toBeCloseTo(result.lpValueQuote, 10);
    expect(result.entryBase * currentPrice + result.entryQuote).toBeCloseTo(result.holdValueQuote, 10);
    expect(result.lpValueQuote - result.holdValueQuote).toBeCloseTo(result.divergenceQuote, 10);
    expect(result.divergenceQuote).toBeLessThanOrEqual(0);
  });

  it("remains finite at extreme supported magnitudes", () => {
    for (const currentPrice of [1e-100, 1, 1e100]) {
      const result = analyzePosition(position({ lowerPrice: 1e-100, upperPrice: 1e100, currentPrice, capitalQuote: 1e100, feesQuote: 1e100, costsQuote: 0, elapsedDays: 1 }));
      for (const value of Object.values(result)) {
        if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it("revalidates typed/forged callers instead of returning invalid financial outputs", () => {
    expect(() => analyzePosition(position({ currentPrice: Infinity }))).toThrow(z.ZodError);
    expect(() => analyzePosition(position({ capitalQuote: Number.MIN_VALUE }))).toThrow(z.ZodError);
    expect(() => analyzePosition(position({ entryPrice: 4 }))).toThrow(z.ZodError);
  });

  it("is deterministic and does not mutate input, read a clock, or fetch live data", () => {
    const input = Object.freeze(position());
    vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("No clock"); });
    vi.stubGlobal("fetch", () => { throw new Error("No live dependencies"); });
    expect(analyzePosition(input)).toEqual(analyzePosition(input));
    expect(input).toEqual(baseline);
  });
});

describe("manual fees, costs, and historical simple APR", () => {
  it("reports supplied fees separately from no-fee divergence and subtracts supplied costs", () => {
    const result = analyzePosition(position({ currentPrice: 4, feesQuote: 2, costsQuote: 1, elapsedDays: 10 }));
    expect(result.feesAprPct).toBeCloseTo(73, 12);
    expect(result.divergenceQuote).toBe(-100);
    expect(result.netVsHoldQuote).toBe(-99);
    expect(result.netPnlQuote).toBe(51);
  });

  it.each([
    { feesQuote: null, costsQuote: null },
    { feesQuote: 2, costsQuote: null },
    { feesQuote: null, costsQuote: 1 },
  ])("withholds both net outputs if either input is unknown: %j", (overrides) => {
    const result = analyzePosition(position({ ...overrides, elapsedDays: 10 }));
    expect(result.netVsHoldQuote).toBeNull();
    expect(result.netPnlQuote).toBeNull();
    expect(result.feesAprPct).toBe(overrides.feesQuote === null ? null : 73);
  });

  it("distinguishes explicitly zero fees/costs from unknown amounts", () => {
    const result = analyzePosition(position({ currentPrice: 4, feesQuote: 0, costsQuote: 0, elapsedDays: 1 }));
    expect(result.feesAprPct).toBe(0);
    expect(result.netVsHoldQuote).toBe(-100);
    expect(result.netPnlQuote).toBe(50);
  });

  it.each([null, 1e-9, 0.5, 0.999999])("withholds APR for missing or sub-day duration %s, not net results", (elapsedDays) => {
    const result = analyzePosition(position({ feesQuote: 2, costsQuote: 1, elapsedDays }));
    expect(result.feesAprPct).toBeNull();
    expect(result.netVsHoldQuote).toBe(1);
    expect(result.netPnlQuote).toBe(1);
  });

  it("uses a simple 365-day historical rate, without compounding or deducting costs", () => {
    const result = analyzePosition(position({ feesQuote: 10, costsQuote: 200, elapsedDays: 365 }));
    expect(result.feesAprPct).toBe(10);
    expect(result.netPnlQuote).toBe(-190);
    expect(analyzePosition(position({ feesQuote: 1, elapsedDays: 1 })).feesAprPct).toBe(365);
  });
});

describe("WorkspaceSchema — bounded import contract", () => {
  it("accepts an empty v1 workspace and strips unknown keys at both levels", () => {
    expect(WorkspaceSchema.parse({ version: 1, positions: [] })).toEqual({ version: 1, positions: [] });
    expect(WorkspaceSchema.parse({ version: 1, positions: [{ ...baseline, secret: "ignored" }], wallet: "ignored" }))
      .toEqual({ version: 1, positions: [baseline] });
  });

  it("accepts 50 unique scenarios but rejects 51", () => {
    const positions = Array.from({ length: 50 }, (_, index) => position({ id: `scenario-${index}` }));
    expect(WorkspaceSchema.safeParse({ version: 1, positions }).success).toBe(true);
    expect(WorkspaceSchema.safeParse({ version: 1, positions: [...positions, position({ id: "extra" })] }).success).toBe(false);
  });

  it("rejects duplicate IDs with a useful issue path instead of overwriting a scenario", () => {
    const parsed = WorkspaceSchema.safeParse({ version: 1, positions: [baseline, position({ label: "Different label" })] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.path.join(".") === "positions.1.id")).toBe(true);
  });

  it.each([
    null, {}, { version: "1", positions: [] }, { version: 2, positions: [] },
    { version: 1, positions: {} }, { version: 1, positions: [null] },
    { version: 1, positions: [{ ...baseline, currentPrice: 0 }] },
  ])("rejects an unsupported or malformed workspace %j", (workspace) => {
    expect(WorkspaceSchema.safeParse(workspace).success).toBe(false);
  });
});
