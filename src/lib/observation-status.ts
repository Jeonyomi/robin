// Display-only age threshold; this does not alter source health or ranking gates.
export const OBSERVATION_FRESH_MS = 3 * 60 * 60 * 1000;

export function observationStatus(value: string | null | undefined, now = Date.now()) {
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return { status: "unknown", label: "Unknown · timestamp unavailable" };
  const age = now - timestamp;
  if (age < 0) return { status: "future", label: "Future timestamp · check source clock" };
  const elapsed = age < 60_000 ? "<1m ago" : age < 3_600_000 ? `${Math.floor(age / 60_000)}m ago` : age < 86_400_000 ? `${Math.floor(age / 3_600_000)}h ago` : `${Math.floor(age / 86_400_000)}d ago`;
  return age <= OBSERVATION_FRESH_MS
    ? { status: "fresh", label: `Fresh · ${elapsed}` }
    : { status: "stale", label: `Stale · ${elapsed}` };
}
