// ── Economic Action Normalization (P-04) ────────────────────────────────────
// Raw token transfers inside a single tx (Wallet→Router→Pool→Router→Wallet)
// must be collapsed into ONE economic action. This module classifies transfers
// using the protocol registry and dedupes router/pool internal movement.

import { isSameAddress } from "@/lib/domain/identity";

export type ActionType =
  | "SWAP"
  | "BRIDGE_IN"
  | "BRIDGE_OUT"
  | "MINT"
  | "BURN"
  | "LP_ADD"
  | "LP_REMOVE"
  | "LEND"
  | "BORROW"
  | "REPAY"
  | "WITHDRAW"
  | "UNKNOWN";

export type Transfer = {
  txHash: string;
  logIndex: number;
  tokenAddress: string;
  fromAddress: string;
  toAddress: string;
  rawValue: string;
  timestamp: string;
};

export type EconomicAction = {
  txHash: string;
  actionIndex: number;
  actionType: ActionType;
  actorAddress: string | null;
  protocol: string | null;
  inputAsset: string | null;
  inputAmount: string | null;
  outputAsset: string | null;
  outputAmount: string | null;
  metadata: Record<string, unknown>;
  timestamp: string;
};

export type ProtocolInfo = {
  protocol: string;
  role: "ROUTER" | "POOL" | "BRIDGE" | "BUNDLER" | "PAYMASTER" | "TREASURY" | "SYSTEM" | "UNKNOWN";
};

// ── Classification Helpers ──────────────────────────────────────────────────

export function isRouter(protocol: ProtocolInfo | null): boolean {
  return protocol?.role === "ROUTER";
}

export function isPool(protocol: ProtocolInfo | null): boolean {
  return protocol?.role === "POOL";
}

export function isBridge(protocol: ProtocolInfo | null): boolean {
  return protocol?.role === "BRIDGE";
}

export function isSystemAddress(protocol: ProtocolInfo | null): boolean {
  return ["BUNDLER", "PAYMASTER", "TREASURY", "SYSTEM"].includes(protocol?.role || "");
}

// ── Transfer → Economic Action Normalization ────────────────────────────────
// Strategy (P-04, Decision 1): classify a single tx by its terminal flow.
// 1. If the tx touches a bridge contract → BRIDGE_IN / BRIDGE_OUT
// 2. If the tx has router + pool transfers → SWAP (actor = first non-router sender)
// 3. Zero-address transfers → MINT / BURN
// 4. Otherwise preserve as UNKNOWN (never force a wrong classification)

export function normalizeEconomicAction(
  transfers: Transfer[],
  resolveProtocol: (address: string) => ProtocolInfo | null,
): EconomicAction | null {
  if (transfers.length === 0) return null;

  const txHash = transfers[0].txHash;
  const timestamp = transfers[0].timestamp;

  // Zero address detection (mint/burn)
  const ZERO = "0x0000000000000000000000000000000000000000";

  // ── MINT / BURN ───────────────────────────────────────────────────────────
  const mintTx = transfers.find((t) => isSameAddress(t.fromAddress, ZERO));
  const burnTx = transfers.find((t) => isSameAddress(t.toAddress, ZERO));

  if (mintTx && !burnTx) {
    return {
      txHash,
      actionIndex: 0,
      actionType: "MINT",
      actorAddress: mintTx.toAddress,
      protocol: null,
      inputAsset: null,
      inputAmount: null,
      outputAsset: mintTx.tokenAddress,
      outputAmount: mintTx.rawValue,
      metadata: { transfers: transfers.length },
      timestamp,
    };
  }

  if (burnTx && !mintTx) {
    return {
      txHash,
      actionIndex: 0,
      actionType: "BURN",
      actorAddress: burnTx.fromAddress,
      protocol: null,
      inputAsset: burnTx.tokenAddress,
      inputAmount: burnTx.rawValue,
      outputAsset: null,
      outputAmount: null,
      metadata: { transfers: transfers.length },
      timestamp,
    };
  }

  // ── BRIDGE detection ──────────────────────────────────────────────────────
  const bridgeContract = transfers.find((t) => {
    const proto = resolveProtocol(t.tokenAddress);
    const fromProto = resolveProtocol(t.fromAddress);
    const toProto = resolveProtocol(t.toAddress);
    return isBridge(proto) || isBridge(fromProto) || isBridge(toProto);
  });

  if (bridgeContract) {
    const fromProto = resolveProtocol(bridgeContract.fromAddress);
    const toProto = resolveProtocol(bridgeContract.toAddress);
    const direction: ActionType = isBridge(fromProto) ? "BRIDGE_OUT" : "BRIDGE_IN";
    return {
      txHash,
      actionIndex: 0,
      actionType: direction,
      actorAddress: isBridge(fromProto) ? bridgeContract.toAddress : bridgeContract.fromAddress,
      protocol: fromProto?.protocol || toProto?.protocol || null,
      inputAsset: bridgeContract.tokenAddress,
      inputAmount: bridgeContract.rawValue,
      outputAsset: null,
      outputAmount: null,
      metadata: { transfers: transfers.length },
      timestamp,
    };
  }

  // ── SWAP detection (router + pool involvement) ────────────────────────────
  const hasRouter = transfers.some((t) => isRouter(resolveProtocol(t.fromAddress)) || isRouter(resolveProtocol(t.toAddress)));
  const hasPool = transfers.some((t) => isPool(resolveProtocol(t.fromAddress)) || isPool(resolveProtocol(t.toAddress)));

  if (hasRouter && hasPool) {
    // Actor = the first transfer participant that is NOT a router/pool/system
    const first = transfers[0];
    let actor = first.fromAddress;
    for (const t of transfers) {
      const proto = resolveProtocol(t.fromAddress);
      if (!isRouter(proto) && !isPool(proto) && !isSystemAddress(proto)) {
        actor = t.fromAddress;
        break;
      }
    }

    const routerProtocol = transfers
      .map((t) => resolveProtocol(t.fromAddress))
      .find((p) => p && isRouter(p));

    return {
      txHash,
      actionIndex: 0,
      actionType: "SWAP",
      actorAddress: actor,
      protocol: routerProtocol?.protocol || null,
      inputAsset: transfers[0].tokenAddress,
      inputAmount: transfers[0].rawValue,
      outputAsset: transfers[transfers.length - 1].tokenAddress,
      outputAmount: transfers[transfers.length - 1].rawValue,
      metadata: { transfers: transfers.length, deduplicated: true },
      timestamp,
    };
  }

  // ── UNKNOWN — preserve raw evidence rather than guessing ──────────────────
  return {
    txHash,
    actionIndex: 0,
    actionType: "UNKNOWN",
    actorAddress: transfers[0].fromAddress,
    protocol: null,
    inputAsset: null,
    inputAmount: null,
    outputAsset: null,
    outputAmount: null,
    metadata: { transfers: transfers.length, rawTransfers: transfers.map((t) => t.logIndex) },
    timestamp,
  };
}
