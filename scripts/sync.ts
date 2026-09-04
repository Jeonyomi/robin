#!/usr/bin/env tsx
/**
 * Data sync CLI — runs locally or in automation and writes to Neon Postgres.
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
import { generateEconomicActions } from "@/lib/jobs/generate-economic-actions";
import { generateSignals } from "@/lib/jobs/generate-signals";
import { publishSnapshotToBlob, formatBytes } from "./lib/snapshot-builder";

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
      case "actions":
        result = await generateEconomicActions();
        break;
      case "signals":
        result = await generateSignals();
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
    const jobs = ["canonical", "metadata", "prices", "metrics", "actions", "signals"];
    for (const j of jobs) await run(j);

    // Publish the local snapshot to Vercel Blob so the deployed UI shows data.
    // Only in "all" mode (hourly) — watch mode re-runs every 5 min and would
    // burn Blob upload bandwidth. Skipped when BLOB_READ_WRITE_TOKEN is unset.
    if (job === "all" && process.env.BLOB_READ_WRITE_TOKEN) {
      console.log("\n▶ publishing snapshot to Vercel Blob");
      try {
        const { url, sizeBytes } = await publishSnapshotToBlob();
        console.log(`✓ snapshot published (${formatBytes(sizeBytes)})`);
        console.log(`  ${url}`);
      } catch (error) {
        console.error(
          "✗ snapshot publish failed:",
          error instanceof Error ? error.message : error
        );
      }
    }

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
