import { unstable_cache } from "next/cache";
import { isFreshLeaderboard, LP_LEADER_FRESH_MS } from "@/lib/lp-leaders";
import { fetchLpLeaderboard } from "./leaders";
import { LP_SNAPSHOT_REVALIDATE_SECONDS, LpUnavailableError, safeLpUnavailable } from "./availability";

// Platform Data Cache, not a process-global cache: cold workers and page refreshes
// reuse one validated observation. No wallet, request headers, secrets or query keys.
// Version this key when accounting/provenance rules change; never cache error bodies.
const readSnapshot = unstable_cache(async () => {
  try { return await fetchLpLeaderboard(); }
  catch (error) { throw safeLpUnavailable(error); } // Next may log background failures.
}, ["robin-lp-verified-snapshot-v2-chain-4663"], { revalidate: LP_SNAPSHOT_REVALIDATE_SECONDS });

export async function fetchSharedLpSnapshot() {
  let data = await readSnapshot();
  // Next may retain its prior entry when revalidation fails. This hard source-age
  // gate still runs on EVERY API request; cache access never renews observedAt.
  // After inactivity, await the worker's shared in-flight refresh rather than
  // immediately returning 503 while that same refresh is already running.
  if (!isFreshLeaderboard(data)) data = await fetchLpLeaderboard();
  if (!isFreshLeaderboard(data)) throw new LpUnavailableError(false);
  return data;
}
export const lpSnapshotPolicy = {
  mode: "shared-verified-snapshot",
  revalidateSeconds: LP_SNAPSHOT_REVALIDATE_SECONDS,
  maxSourceAgeSeconds: LP_LEADER_FRESH_MS / 1000,
} as const;
