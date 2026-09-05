import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { isFreshLeaderboard, LpLeaderboardSchema, type LpLeaderboard } from "@/lib/lp-leaders";

const KEY = "uniswap-v3:4663:sample12:v1";
const MANAGER = "0x73991a25c818bf1f1128deaab1492d45638de0d3";
export type LpCollectorError = "rate-limit" | "timeout" | "source-invalid" | "storage" | "other";
export interface StoredLpSnapshot {
  data: LpLeaderboard;
  collector: { publishedAt: string; lastAttemptAt: string; lastAttemptOk: boolean; lastError: LpCollectorError | null; producerRevision: string };
}
export type LpSnapshotQuery = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
const SELECT = `SELECT snapshot, block_number::text AS block_number, observed_at, published_at,
  last_attempt_at, last_attempt_ok, last_error, producer_revision
  FROM public.lp_leaderboard_snapshots WHERE source_key = $1`;
const revisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
const errorSchema = z.enum(["rate-limit", "timeout", "source-invalid", "storage", "other"]);
function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(z.string().parse(value));
  return date.toISOString();
}
export function validatedPublishedBoard(value: unknown): LpLeaderboard {
  const data = LpLeaderboardSchema.parse(value);
  if (data.positionManager.toLowerCase() !== MANAGER || data.sampled > 12 || data.sampled > data.totalNfts || data.rows.length !== data.eligible || data.sampled !== data.eligible + data.excluded + data.unsupported || new Set(data.rows.map((r) => r.tokenId)).size !== data.rows.length || data.rows.some((r) => r.lowerWethPerBase >= r.upperWethPerBase || ![r.token0.address.toLowerCase(), r.token1.address.toLowerCase()].includes(data.weth.toLowerCase()) || r.baseAddress.toLowerCase() === data.weth.toLowerCase())) throw new Error("LP published snapshot failed integrity checks.");
  return data;
}

/** Bound parameters only; one LP-specific table, with monotonic atomic publication. */
export function createLpSnapshotStore(query: LpSnapshotQuery, now = Date.now) {
  const read = async (): Promise<StoredLpSnapshot | null> => {
    const [row] = await query(SELECT, [KEY]);
    if (!row?.snapshot) return null;
    const data = validatedPublishedBoard(row.snapshot);
    if (String(row.block_number) !== data.blockNumber || timestamp(row.observed_at) !== data.observedAt) throw new Error("LP stored observation metadata does not match its payload.");
    return { data, collector: { publishedAt: timestamp(row.published_at), lastAttemptAt: timestamp(row.last_attempt_at), lastAttemptOk: z.boolean().parse(row.last_attempt_ok), lastError: row.last_error === null ? null : errorSchema.parse(row.last_error), producerRevision: revisionSchema.parse(row.producer_revision) } };
  };
  return {
    read,
    async preflight() { await query("SELECT source_key FROM public.lp_leaderboard_snapshots LIMIT 1", []); },
    async publish(value: unknown, revision: string, attemptAt: string): Promise<boolean> {
      const data = validatedPublishedBoard(value); revisionSchema.parse(revision); timestamp(attemptAt);
      if (!isFreshLeaderboard(data, now())) throw new Error("Expired LP observations cannot be published.");
      const result = await query(`INSERT INTO public.lp_leaderboard_snapshots
        (source_key, snapshot, block_number, observed_at, published_at, last_attempt_at, last_attempt_ok, last_error, producer_revision)
        VALUES ($1, $2::jsonb, $3::bigint, $4::timestamptz, now(), $5::timestamptz, true, NULL, $6)
        ON CONFLICT (source_key) DO UPDATE SET snapshot = EXCLUDED.snapshot, block_number = EXCLUDED.block_number,
          observed_at = EXCLUDED.observed_at, published_at = EXCLUDED.published_at, last_attempt_at = EXCLUDED.last_attempt_at,
          last_attempt_ok = true, last_error = NULL, producer_revision = EXCLUDED.producer_revision
        WHERE lp_leaderboard_snapshots.block_number IS NULL OR
          (EXCLUDED.block_number > lp_leaderboard_snapshots.block_number AND EXCLUDED.observed_at >= lp_leaderboard_snapshots.observed_at
           AND EXCLUDED.last_attempt_at >= lp_leaderboard_snapshots.last_attempt_at)
        RETURNING block_number::text AS block_number`, [KEY, JSON.stringify(data), data.blockNumber, data.observedAt, attemptAt, revision]);
      if (result.length) return true;
      const current = await read();
      if (current?.data.blockNumber === data.blockNumber && current.data.blockHash === data.blockHash && current.data.observedAt === data.observedAt) return false; // Idempotent, no timestamp renewal.
      throw new Error("LP publication refused a regressing or conflicting observation.");
    },
    async recordFailure(code: LpCollectorError, attemptAt: string) {
      errorSchema.parse(code); timestamp(attemptAt);
      // A failure never erases the last accepted payload or renews its source/publish time.
      await query(`INSERT INTO public.lp_leaderboard_snapshots (source_key, last_attempt_at, last_attempt_ok, last_error)
        VALUES ($1, $2::timestamptz, false, $3)
        ON CONFLICT (source_key) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at,
          last_attempt_ok = false, last_error = EXCLUDED.last_error
        WHERE EXCLUDED.last_attempt_at >= lp_leaderboard_snapshots.last_attempt_at`, [KEY, attemptAt, code]);
    },
  };
}

export const lpSnapshotQuery: LpSnapshotQuery = async (text, params) => {
  const url = process.env.DATABASE_URL;
  if (!url || !new URL(url).hostname.endsWith(".neon.tech")) throw new Error("LP snapshots require the configured Neon database; no RPC fallback is allowed.");
  const sql = neon(url);
  return await sql.query(text, params, { fetchOptions: { cache: "no-store", signal: AbortSignal.timeout(5_000) } });
};
export const lpSnapshotStore = createLpSnapshotStore(lpSnapshotQuery);
export const readStoredLpSnapshot = () => lpSnapshotStore.read();
