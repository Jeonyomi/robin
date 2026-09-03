#!/usr/bin/env tsx
/**
 * Local data sync CLI — runs on this machine, writes to local SQLite.
 *
 * Usage:
 *   pnpm sync            # all jobs
 *   pnpm sync canonical  # Robinhood /rhj/assets registry
 *   pnpm sync metadata   # Blockscout token metadata for canonical tokens
 *   pnpm sync prices     # Robinhood reference prices
 *   pnpm sync metrics    # compute metric snapshots + signals from DB
 *   pnpm sync watch      # run all jobs on an interval (5 min)
 */
import "dotenv/config";
import { syncCanonicalAssets } from "@/lib/jobs/sync-canonical-assets";
import { syncTokenMetadata } from "@/lib/jobs/sync-token-metadata";
import { syncReferencePrices } from "@/lib/jobs/sync-reference-prices";
import { calculateTokenMetrics } from "@/lib/jobs/calculate-metrics";

const job = process.argv[2] || "all";

async function run(jobName: string) {
  const started = Date.now();
  console.log(`\n▶ ${jobName} — ${new Date().toISOString()}`);
  try {
    let result: unknown;
    switch (jobName) {
      case "canonical":
        result = await syncCanonicalAssets();
        break;
      case "metadata":
        result = await syncTokenMetadata();
        break;
      case "prices":
        result = await syncReferencePrices();
        break;
      case "metrics":
        result = await calculateTokenMetrics();
        break;
      default:
        throw new Error(`Unknown job: ${jobName}`);
    }
    console.log(`✓ ${jobName} done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (result) console.log("  ", JSON.stringify(result).slice(0, 500));
  } catch (error) {
    console.error(`✗ ${jobName} failed:`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

async function main() {
  if (job === "all" || job === "watch") {
    const jobs = ["canonical", "metadata", "prices", "metrics"];
    for (const j of jobs) await run(j);
    if (job === "watch") {
      console.log("\n⏱ Watching — re-running every 5 minutes. Ctrl+C to stop.");
      setInterval(async () => {
        for (const j of jobs) await run(j);
      }, 5 * 60 * 1000);
    }
  } else {
    await run(job);
  }
}

main();
