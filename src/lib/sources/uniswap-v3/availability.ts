import { isFreshLeaderboard, type LpLeaderboard } from "@/lib/lp-leaders";
import { lpSourceDiagnostic } from "./source-error";

// Leave time for the next 90s collection before the 5-minute source-age cutoff.
export const LP_SNAPSHOT_REVALIDATE_SECONDS = 90;
export const LP_COLLECTION_TIMEOUT_MS = 90_000;

/** Safe for the API and for Next's background-revalidation error logging. No raw cause. */
export class LpUnavailableError extends Error {
  readonly code: number;
  constructor(readonly limited: boolean, readonly retryAfterSeconds = limited ? 60 : 15) {
    super(limited ? "LP data source is rate-limited. Please wait before retrying." : "LP ranking data is unavailable. No estimated or stale ranking is substituted.");
    this.name = "Error";
    this.code = limited ? 429 : 503;
  }
}
export function safeLpUnavailable(error: unknown): LpUnavailableError {
  if (error instanceof LpUnavailableError) return new LpUnavailableError(error.limited, error.retryAfterSeconds);
  const limited = lpSourceDiagnostic(error).some((item) => item.category === "rate-limit");
  let delay = limited ? 60 : 15;
  let current = error;
  for (let i = 0; i < 6 && current && typeof current === "object"; i++) {
    if (current instanceof LpUnavailableError) delay = Math.max(delay, current.retryAfterSeconds);
    current = "cause" in current ? current.cause : undefined;
  }
  return new LpUnavailableError(limited, delay);
}

/** Single flight and negative caching per worker; a shared Data Cache wraps successful snapshots. */
export function createLpSnapshotService(collect: () => Promise<LpLeaderboard>, now = Date.now) {
  let cached: { data: LpLeaderboard; fetchedAt: number } | undefined;
  let flight: Promise<LpLeaderboard> | undefined;
  let failure: { error: LpUnavailableError; until: number } | undefined;
  return (): Promise<LpLeaderboard> => {
    if (cached && now() - cached.fetchedAt < LP_SNAPSHOT_REVALIDATE_SECONDS * 1000 && isFreshLeaderboard(cached.data, now())) return Promise.resolve(cached.data);
    if (failure && now() < failure.until) return Promise.reject(new LpUnavailableError(failure.error.limited, Math.max(1, Math.ceil((failure.until - now()) / 1000))));
    if (!flight) flight = Promise.resolve().then(collect).then((data) => {
      if (!isFreshLeaderboard(data, now())) throw new LpUnavailableError(false);
      cached = { data, fetchedAt: now() }; failure = undefined;
      return data;
    }).catch((error) => {
      console.warn("LP_LEADERS_COLLECTION_FAILURE", JSON.stringify(lpSourceDiagnostic(error)));
      const safe = safeLpUnavailable(error);
      cached = undefined;
      failure = { error: safe, until: now() + safe.retryAfterSeconds * 1000 };
      throw safe;
    }).finally(() => { flight = undefined; });
    return flight;
  };
}
