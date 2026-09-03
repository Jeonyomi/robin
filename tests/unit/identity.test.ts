import { describe, it, expect } from "vitest";
import {
  normalizeAddress,
  resolveCanonicalAsset,
  detectTickerCollisions,
  isCanonicalStockToken,
} from "@/lib/domain/identity";
import {
  CANONICAL_GME_ADDRESS,
  LOOKALIKE_GME_ADDRESS,
  canonicalGmeAsset,
  canonicalAssetsFixture,
} from "../fixtures/tokens";

describe("address normalization", () => {
  it("normalizes to lowercase for exact comparison", () => {
    expect(normalizeAddress("0x1b0E319c6A659F002271B69dB8A7df2F911c153E")).toBe(
      "0x1b0e319c6a659f002271b69db8a7df2f911c153e"
    );
  });

  it("treats checksum and lowercase addresses as equal", () => {
    expect(normalizeAddress("0xAbC123")).toBe(normalizeAddress("0xabc123"));
  });
});

describe("canonical asset resolution — GME collision (P-01)", () => {
  it("resolves the official GME contract as CANONICAL", () => {
    const result = resolveCanonicalAsset(4663, CANONICAL_GME_ADDRESS, canonicalAssetsFixture);
    expect(result.status).toBe("CANONICAL");
    expect(result.asset?.symbol).toBe("GME");
  });

  it("marks the lookalike GME contract as NON_CANONICAL", () => {
    const result = resolveCanonicalAsset(4663, LOOKALIKE_GME_ADDRESS, canonicalAssetsFixture);
    expect(result.status).toBe("NON_CANONICAL");
    expect(result.asset).toBeNull();
  });

  it("lookalike cannot masquerade as canonical (exact match only)", () => {
    expect(resolveCanonicalAsset(4663, LOOKALIKE_GME_ADDRESS, canonicalAssetsFixture).status).not.toBe(
      "CANONICAL"
    );
  });

  it("returns NON_CANONICAL for unknown contract with stock-like ticker", () => {
    const result = resolveCanonicalAsset(4663, "0x000000000000000000000000000000000000dead", [
      canonicalGmeAsset,
    ]);
    expect(result.status).toBe("NON_CANONICAL");
  });

  it("rejects addresses on the wrong chain", () => {
    const result = resolveCanonicalAsset(1, CANONICAL_GME_ADDRESS, canonicalAssetsFixture);
    expect(result.status).toBe("NON_CANONICAL");
  });

  it("handles case-insensitive contract comparison", () => {
    const upper = CANONICAL_GME_ADDRESS.toUpperCase();
    const result = resolveCanonicalAsset(4663, upper, canonicalAssetsFixture);
    expect(result.status).toBe("CANONICAL");
  });
});

describe("isCanonicalStockToken", () => {
  it("returns true for canonical address", () => {
    expect(isCanonicalStockToken(CANONICAL_GME_ADDRESS, canonicalAssetsFixture)).toBe(true);
  });

  it("returns false for lookalike address", () => {
    expect(isCanonicalStockToken(LOOKALIKE_GME_ADDRESS, canonicalAssetsFixture)).toBe(false);
  });
});

describe("ticker collision detection", () => {
  it("detects no collisions when symbols are unique", () => {
    const collisions = detectTickerCollisions([canonicalGmeAsset]);
    expect(collisions).toHaveLength(0);
  });

  it("detects collision when two assets share a symbol", () => {
    const duplicate = {
      ...canonicalGmeAsset,
      id: "rhj-DUP",
      contractAddress: LOOKALIKE_GME_ADDRESS.toLowerCase(),
    };
    const collisions = detectTickerCollisions([canonicalGmeAsset, duplicate]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].symbol).toBe("GME");
    expect(collisions[0].collisionAddresses).toContain(LOOKALIKE_GME_ADDRESS.toLowerCase());
  });
});
