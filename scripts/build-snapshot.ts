/**
 * Build data/snapshot.json from the local SQLite DB (no upload).
 *   pnpm build:snapshot
 */
import "dotenv/config";
import { buildSnapshot, writeSnapshot, formatBytes } from "./lib/snapshot-builder";

async function main() {
  const started = Date.now();
  console.log("▶ Building snapshot from local DB…");
  const snapshot = await buildSnapshot();
  const { filePath, sizeBytes } = writeSnapshot(snapshot);

  const tokenCount = Object.keys(snapshot.tokenDetails).length;
  console.log(`✓ Snapshot built in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  File: ${filePath}`);
  console.log(`  Size: ${formatBytes(sizeBytes)}`);
  console.log(
    `  Contents: overview (${Object.keys(snapshot.overview).length} windows), ` +
      `stockTokens (${Object.keys(snapshot.stockTokens).length} windows), ` +
      `tokenDetails (${tokenCount}), tokensScanner (${snapshot.tokensScanner.length}), ` +
      `syncStates (${snapshot.syncStates.length})`
  );
}

main().catch((error) => {
  console.error("✗ Snapshot build failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
