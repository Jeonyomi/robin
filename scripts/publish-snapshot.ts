/**
 * Build the snapshot from local DB and upload it to Vercel Blob.
 *   pnpm publish:snapshot
 *
 * Requires BLOB_READ_WRITE_TOKEN in .env (Vercel dashboard → Storage → Blob).
 * Prints the public URL — set it as SNAPSHOT_URL_V3 on Vercel (and optionally in
 * .env for local parity with the deployed UI).
 */
import "dotenv/config";
import { publishSnapshotToBlob, formatBytes } from "./lib/snapshot-builder";

async function main() {
  const started = Date.now();
  console.log("▶ Building snapshot…");
  const { url, sizeBytes } = await publishSnapshotToBlob();
  console.log(`✓ Published in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  Size: ${formatBytes(sizeBytes)}`);
  console.log("");
  console.log("  Public URL:");
  console.log(`  ${url}`);
  console.log("");
  console.log("  Next step: set this URL as SNAPSHOT_URL_V3 in your Vercel project");
  console.log("  (Settings → Environment Variables → Production) and redeploy.");
}

main().catch((error) => {
  console.error("✗ Publish failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
