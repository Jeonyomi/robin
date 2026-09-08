import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { remainingLpCooldown, persistLpCooldown } from "../src/lib/sources/uniswap-v3/collector-cooldown";
import { safeLpUnavailable } from "../src/lib/sources/uniswap-v3/availability";
import { fetchLpLeaderboard } from "../src/lib/sources/uniswap-v3/leaders";
import { lpSnapshotStore, type LpCollectorError } from "../src/lib/sources/uniswap-v3/snapshot-store";
import { lpSourceDiagnostic } from "../src/lib/sources/uniswap-v3/source-error";

config({ path: ".env.local", quiet: true });
config({ quiet: true });
const attemptAt = new Date().toISOString();
let phase: "preflight" | "source" | "storage" = "preflight";
let revision = "";
const cooldownFile = join(homedir(), ".local/state/robin-lp/cooldown.json");
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("LP collector requires DATABASE_URL.");
  revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(revision) || execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) throw new Error("LP collector requires a clean, revision-pinned checkout.");
  const remaining = remainingLpCooldown(cooldownFile);
  if (remaining) { console.log(JSON.stringify({ status: "skipped", reason: "source-cooldown", retryAfterSeconds: remaining, revision })); return; }
  phase = "storage";
  await lpSnapshotStore.preflight();
  phase = "source";
  const data = await fetchLpLeaderboard();
  phase = "storage";
  const published = await lpSnapshotStore.publish(data, revision, attemptAt);
  const stored = await lpSnapshotStore.read();
  if (!stored || stored.data.blockNumber !== data.blockNumber || stored.data.blockHash !== data.blockHash) throw new Error("LP publication read-back did not match.");
  console.log(JSON.stringify({ status: "ok", published, revision, block: stored.data.blockNumber, observedAt: stored.data.observedAt, publishedAt: stored.collector.publishedAt, sampled: stored.data.sampled, eligible: stored.data.eligible }));
}
main().catch(async (error: unknown) => {
  const diagnostics = lpSourceDiagnostic(error);
  // Provider failures may be wrapped by viem; inspect the entire safe cause chain.
  const limited = diagnostics.some((item) => item.category === "rate-limit");
  const timedOut = diagnostics.some((item) => item.category === "timeout");
  const code: LpCollectorError = phase === "storage" ? "storage" : limited ? "rate-limit" : timedOut ? "timeout" : phase === "source" ? "source-invalid" : "other";
  const retryAfterSeconds = safeLpUnavailable(error).retryAfterSeconds;
  if (code === "rate-limit") {
    try { persistLpCooldown(cooldownFile, retryAfterSeconds); }
    catch { console.error(JSON.stringify({ status: "error", phase: "cooldown-write", code: "storage" })); }
  }
  if (process.env.DATABASE_URL) {
    try { await lpSnapshotStore.recordFailure(code, attemptAt); }
    catch { console.error(JSON.stringify({ status: "error", phase: "failure-state-write", code: "storage" })); }
  }
  console.error(JSON.stringify({ status: "error", phase, code, revision, retryAfterSeconds, diagnostics }));
  process.exitCode = 1;
});
