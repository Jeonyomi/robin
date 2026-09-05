import { describe, it, expect } from "vitest";
import { inputAge, parseWorkspace, serializeWorkspace, MAX_WORKSPACE_BYTES } from "@/lib/lp-workspace";
import type { PositionInput } from "@/lib/domain/lp";

const now = Date.parse("2026-09-05T10:00:00Z");
const position: PositionInput = { id: "one", label: "Math test only", baseSymbol: "BASE", quoteSymbol: "QUOTE", entryPrice: 1, currentPrice: 4, lowerPrice: 0.25, upperPrice: 4, capitalQuote: 100, feesQuote: null, costsQuote: null, elapsedDays: null, observedAt: "2026-09-05T09:00:00.000Z" };
const encode = (positions = [position]) => JSON.stringify({ version: 1, positions });

describe("LP workspace persistence boundaries", () => {
  it("accepts a valid empty workspace and retains unknown fees as null", () => {
    expect(parseWorkspace(encode([]), now).positions).toEqual([]);
    expect(parseWorkspace(encode(), now).positions[0].feesQuote).toBeNull();
  });
  it("rejects future observations", () => expect(() => parseWorkspace(encode([{ ...position, observedAt: "2026-09-05T10:01:00.000Z" }]), now)).toThrow(/future/));
  it("rejects old schema versions instead of silently migrating", () => expect(() => parseWorkspace('{"version":0,"positions":[]}', now)).toThrow(/Invalid/));
  it("rejects malformed JSON and oversized backups", () => {
    expect(() => parseWorkspace("broken", now)).toThrow();
    expect(() => parseWorkspace(" ".repeat(MAX_WORKSPACE_BYTES + 1), now)).toThrow(/256 KB/);
  });
  it("bounds bytes rather than just character count", () => expect(() => parseWorkspace("가".repeat(MAX_WORKSPACE_BYTES / 2), now)).toThrow(/256 KB/));
  it("rejects duplicate IDs, too many positions and invalid math", () => {
    expect(() => parseWorkspace(encode([position, position]), now)).toThrow();
    expect(() => parseWorkspace(encode(Array.from({ length: 51 }, (_, i) => ({ ...position, id: String(i) }))), now)).toThrow();
    expect(() => parseWorkspace(encode([{ ...position, lowerPrice: 4 }]), now)).toThrow();
  });
  it("does not preserve forged chain-verification fields", () => {
    const raw = JSON.stringify({ version: 1, positions: [{ ...position, source: "onchain", verified: true }] });
    expect(parseWorkspace(raw, now).positions[0]).not.toHaveProperty("verified");
    expect(parseWorkspace(raw, now).positions[0]).not.toHaveProperty("source");
  });
  it("round-trips canonical user inputs", () => {
    const historical = { ...position, observedAt: "2020-01-01T00:00:00.000Z" };
    expect(JSON.parse(serializeWorkspace([historical])).positions[0]).toEqual(historical);
  });
  it("marks old or clock-skewed inputs as noncurrent", () => {
    expect(inputAge(position, now)).toBe("recent");
    expect(inputAge(position, now + 3 * 60 * 60 * 1000)).toBe("stale");
    expect(inputAge(position, now - 2 * 60 * 60 * 1000)).toBe("invalid");
    expect(inputAge({ ...position, observedAt: "bad" }, now)).toBe("invalid");
  });
});
