import { describe, it, expect } from "vitest";
import { normalizeEconomicAction, type Transfer, type ProtocolInfo } from "@/lib/domain/economic-actions";

const ROUTER = "0x1111111111111111111111111111111111111111";
const POOL = "0x2222222222222222222222222222222222222222";
const BRIDGE = "0x3333333333333333333333333333333333333333";
const WALLET_A = "0xaaa1111111111111111111111111111111111111";
const WALLET_B = "0xbbb2222222222222222222222222222222222222";
const TOKEN = "0xccc3333333333333333333333333333333333333";
const ZERO = "0x0000000000000000000000000000000000000000";

function resolveProtocol(address: string): ProtocolInfo | null {
  switch (address) {
    case ROUTER: return { protocol: "universal-router", role: "ROUTER" };
    case POOL: return { protocol: "uniswap-pool", role: "POOL" };
    case BRIDGE: return { protocol: "relay", role: "BRIDGE" };
    default: return null;
  }
}

const base: Transfer = {
  txHash: "0xabc",
  logIndex: 0,
  tokenAddress: TOKEN,
  fromAddress: WALLET_A,
  toAddress: WALLET_B,
  rawValue: "1000000",
  timestamp: "2026-09-03T12:00:00Z",
};

describe("normalizeEconomicAction — P-04 dedup", () => {
  it("collapses a 4-transfer swap (Wallet→Router→Pool→Router→Wallet) into ONE SWAP", () => {
    const transfers: Transfer[] = [
      { ...base, logIndex: 0, fromAddress: WALLET_A, toAddress: ROUTER, rawValue: "1000" },
      { ...base, logIndex: 1, fromAddress: ROUTER, toAddress: POOL, rawValue: "1000" },
      { ...base, logIndex: 2, fromAddress: POOL, toAddress: ROUTER, rawValue: "990" },
      { ...base, logIndex: 3, fromAddress: ROUTER, toAddress: WALLET_B, rawValue: "990" },
    ];
    const action = normalizeEconomicAction(transfers, resolveProtocol);
    expect(action).not.toBeNull();
    expect(action!.actionType).toBe("SWAP");
    expect(action!.metadata.deduplicated).toBe(true);
    expect(action!.actorAddress).toBe(WALLET_A);
    expect(action!.protocol).toBe("universal-router");
  });

  it("classifies bridge direction (BRIDGE_IN when bridge is the destination)", () => {
    const transfers: Transfer[] = [
      { ...base, logIndex: 0, fromAddress: WALLET_A, toAddress: BRIDGE },
    ];
    const action = normalizeEconomicAction(transfers, resolveProtocol);
    expect(action!.actionType).toBe("BRIDGE_IN");
    expect(action!.protocol).toBe("relay");
  });

  it("classifies BRIDGE_OUT when bridge is the source", () => {
    const transfers: Transfer[] = [
      { ...base, logIndex: 0, fromAddress: BRIDGE, toAddress: WALLET_B },
    ];
    const action = normalizeEconomicAction(transfers, resolveProtocol);
    expect(action!.actionType).toBe("BRIDGE_OUT");
  });

  it("classifies MINT when from is zero address", () => {
    const transfers: Transfer[] = [{ ...base, fromAddress: ZERO, toAddress: WALLET_A }];
    const action = normalizeEconomicAction(transfers, resolveProtocol);
    expect(action!.actionType).toBe("MINT");
    expect(action!.actorAddress).toBe(WALLET_A);
  });

  it("classifies BURN when to is zero address", () => {
    const transfers: Transfer[] = [{ ...base, fromAddress: WALLET_A, toAddress: ZERO }];
    const action = normalizeEconomicAction(transfers, resolveProtocol);
    expect(action!.actionType).toBe("BURN");
  });

  it("preserves UNKNOWN instead of guessing", () => {
    const transfers: Transfer[] = [{ ...base, fromAddress: WALLET_A, toAddress: WALLET_B }];
    const action = normalizeEconomicAction(transfers, resolveProtocol);
    expect(action!.actionType).toBe("UNKNOWN");
    expect(action!.metadata.rawTransfers).toContain(0);
  });

  it("returns null for empty transfers", () => {
    expect(normalizeEconomicAction([], resolveProtocol)).toBeNull();
  });
});
