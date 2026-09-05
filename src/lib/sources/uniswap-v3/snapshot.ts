import { isFreshLeaderboard, LP_LEADER_FRESH_MS } from "@/lib/lp-leaders";
import { LpUnavailableError } from "./availability";
import { readStoredLpSnapshot } from "./snapshot-store";

/** Read-only path: never imports or invokes the on-chain collector. */
export async function fetchSharedLpSnapshot() {
  const record = await readStoredLpSnapshot();
  if (!record || !isFreshLeaderboard(record.data)) throw new LpUnavailableError(false);
  return record;
}

export const lpSnapshotPolicy = {
  mode: "scheduled-verified-snapshot",
  collectionIntervalSeconds: 120,
  maxSourceAgeSeconds: LP_LEADER_FRESH_MS / 1000,
  storage: "neon-postgres",
} as const;
