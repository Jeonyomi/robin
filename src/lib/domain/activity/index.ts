export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type TransferKind = "mint" | "burn" | "transfer";

export function classifyTransfer(fromAddress: string, toAddress: string): TransferKind {
  const from = fromAddress.toLowerCase();
  const to = toAddress.toLowerCase();
  if (from === ZERO_ADDRESS) return "mint";
  if (to === ZERO_ADDRESS) return "burn";
  return "transfer";
}

export function normalizeTokenAmount(rawValue: string | null, decimals: number | null): number | null {
  if (!rawValue || decimals === null || decimals < 0 || !Number.isInteger(decimals)) return null;

  try {
    const raw = BigInt(rawValue);
    const scale = BigInt(10) ** BigInt(decimals);
    const whole = raw / scale;
    const remainder = raw % scale;
    const decimal = decimals > 0 ? remainder.toString().padStart(decimals, "0").replace(/0+$/, "") : "";
    const normalized = Number(decimal ? `${whole}.${decimal}` : whole.toString());
    return Number.isFinite(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

export function calculateMomentum(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function calculateActivityIndex(
  transfers: number,
  activeAddresses: number,
  maxTransfers: number,
  maxActiveAddresses: number,
): number {
  const transferComponent = maxTransfers > 0 ? transfers / maxTransfers : 0;
  const addressComponent = maxActiveAddresses > 0 ? activeAddresses / maxActiveAddresses : 0;
  return Math.round(Math.min(1, 0.6 * transferComponent + 0.4 * addressComponent) * 100);
}

export function buildActivityEvidence(
  transfers: number,
  previousTransfers: number,
  activeAddresses: number,
  holderDelta: number | null,
): string[] {
  const evidence = [`${transfers.toLocaleString()} transfers across ${activeAddresses.toLocaleString()} addresses`];
  const momentum = calculateMomentum(transfers, previousTransfers);

  if (momentum === null && transfers > 0) {
    evidence.push("Newly observed versus the previous window");
  } else if (momentum !== null && Math.abs(momentum) >= 10) {
    evidence.push(`${momentum > 0 ? "+" : ""}${momentum.toFixed(0)}% transfer count versus previous window`);
  } else {
    evidence.push("Transfer count is broadly stable versus the previous window");
  }

  if (holderDelta !== null && holderDelta !== 0) {
    evidence.push(`${holderDelta > 0 ? "+" : ""}${holderDelta.toLocaleString()} holders at the latest snapshot`);
  }

  return evidence;
}
