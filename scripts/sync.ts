#!/usr/bin/env tsx
/**
 * Data sync CLI — runs locally or in automation and writes to Neon Postgres.
 *
 * Usage:
 *   pnpm sync            # all jobs
 *   pnpm sync canonical  # Robinhood /rhj/assets registry
 *   pnpm sync stats      # Blockscout chain-wide public statistics
 *   pnpm sync metadata   # rotating Blockscout token metadata batch
 *   pnpm sync prices     # Robinhood reference prices
 *   pnpm sync transfers  # bounded real token-transfer ingestion
 *   pnpm sync metrics    # compute holder deltas from source observations
 *   pnpm sync watch      # run all jobs on an interval (5 min)
 */
import "dotenv/config";
import { syncCanonicalAssets } from "@/lib/jobs/sync-canonical-assets";
import { syncChainStats } from "@/lib/jobs/sync-chain-stats";
import { syncTokenMetadata } from "@/lib/jobs/sync-token-metadata";
import { syncReferencePrices } from "@/lib/jobs/sync-reference-prices";
import { syncTokenTransfers } from "@/lib/jobs/sync-token-transfers";
import { calculateTokenMetrics } from "@/lib/jobs/calculate-metrics";
import { generateEconomicActions } from "@/lib/jobs/generate-economic-actions";
import { generateSignals } from "@/lib/jobs/generate-signals";
import { publishSnapshotToBlob, formatBytes } from "./lib/snapshot-builder";

const job = process.argv[2] || "all";
const allowSyntheticActions = process.env.ALLOW_SYNTHETIC_ACTIONS === "true";

async function run(jobName: string): Promise<boolean> {
  const started = Date.now();
  console.log(`\n▶ ${jobName} — ${new Date().toISOString()}`);
  try {
    let result: unknown;
    switch (jobName) {
      case "canonical":
        result = await syncCanonicalAssets();
        break;
      case "stats":
        result = await syncChainStats();
        break;
      case "metadata":
        result = await syncTokenMetadata();
        break;
      case "prices":
        result = await syncReferencePrices();
        break;
      case "transfers":
        result = await syncTokenTransfers();
        break;
      case "metrics":
        result = await calculateTokenMetrics();
        break;
      case "actions":
        if (!allowSyntheticActions) {
          throw new Error(
            "Synthetic economic actions are disabled. Set ALLOW_SYNTHETIC_ACTIONS=true only for explicit demo runs.",
          );
        }
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
    return true;
  } catch (error) {
    console.error(`✗ ${jobName} failed:`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return false;
  }
}

async function main() {
  if (job === "all" || job === "watch") {
    const jobs = [
      "canonical",
      "stats",
      "metadata",
      "prices",
      "transfers",
      "metrics",
      ...(allowSyntheticActions ? ["actions"] : []),
    ];
    if (!allowSyntheticActions) {
      console.log("ℹ synthetic economic actions skipped (fail-closed default)");
    }
    console.log("ℹ heuristic signals skipped in the default sync; the dashboard uses observed activity only");
    let allSucceeded = true;
    for (const j of jobs) {
      if (!(await run(j))) allSucceeded = false;
    }

    // Publish the local snapshot to Vercel Blob so the deployed UI shows data.
    // Only in "all" mode (scheduled) — watch mode re-runs every 5 min and would
    // burn Blob upload bandwidth. Skipped when BLOB_READ_WRITE_TOKEN is unset.
    if (job === "all" && process.env.BLOB_READ_WRITE_TOKEN && allSucceeded) {
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
        process.exitCode = 1;
      }
    } else if (job === "all" && process.env.BLOB_READ_WRITE_TOKEN && !allSucceeded) {
      console.error("✗ snapshot publish skipped because one or more sync jobs failed");
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
