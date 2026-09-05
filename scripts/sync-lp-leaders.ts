import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { fetchLpLeaderboard } from "../src/lib/sources/uniswap-v3/leaders";
import { lpSnapshotStore, type LpCollectorError } from "../src/lib/sources/uniswap-v3/snapshot-store";
import { lpSourceDiagnostic } from "../src/lib/sources/uniswap-v3/source-error";

config({ path: ".env.local", quiet: true });
config({ quiet: true });
const attemptAt = new Date().toISOString();
let phase: "preflight" | "source" | "storage" = "preflight";
let revision = "";
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("LP collector requires DATABASE_URL.");
  revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(revision) || execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) throw new Error("LP collector requires a clean, revision-pinned checkout.");
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
  const category = diagnostics[0]?.category;
  const code: LpCollectorError = phase === "storage" ? "storage" : category === "rate-limit" ? "rate-limit" : category === "timeout" ? "timeout" : phase === "source" ? "source-invalid" : "other";
  if (process.env.DATABASE_URL) {
    try { await lpSnapshotStore.recordFailure(code, attemptAt); }
    catch { console.error(JSON.stringify({ status: "error", phase: "failure-state-write", code: "storage" })); }
  }
  console.error(JSON.stringify({ status: "error", phase, code, revision, diagnostics }));
  process.exitCode = 1;
});
