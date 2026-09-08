"use client";

import { useEffect, useState } from "react";
import type { OverviewData } from "@/lib/queries";
import { observationStatus } from "@/lib/observation-status";

export function ObservationFreshness({ data }: { data: OverviewData | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  const sources = [
    ["CHAIN OBSERVED", data?.chain?.observedAt],
    ["GAS UPDATED", data?.gas?.updatedAt],
    ["TRANSFER OBSERVED", data?.activity.lastObservedAt],
    ["TRANSFER INDEXED", data?.coverage.lastIndexedAt],
  ] as const;
  return (
    <div aria-label="Observation freshness">
      {sources.map(([label, timestamp]) => {
        const { status, label: age } = observationStatus(timestamp);
        return <div className="status-line" key={label}>
          <span className="status-key">{label}</span>
          <strong title={timestamp ?? undefined} data-freshness={status}>{age}</strong>
        </div>;
      })}
      <p className="metric-note">Fresh = timestamp within 3h. Chain observed is the last accepted stats fetch, not the chain head time; provider counters may lag. Each source is assessed separately; transfer recency does not establish chain freshness or complete coverage.</p>
    </div>
  );
}

export function CurrentRotation({ coverage }: { coverage: OverviewData["coverage"] | undefined }) {
  if (coverage?.collectionMode === "bounded-recent-rpc") return <div>
    <span className="scope-label">OBSERVATION COVERAGE</span>
    <strong>Up to 48-block recent RPC sample/pulse</strong>
    <p>Blocks {coverage.scanFromBlock ?? "?"}–{coverage.scannedToBlock ?? "?"}; {coverage.skippedBlocks ?? "Unknown"} skipped blocks. Gaps are not backfilled; this is not continuous indexing.</p>
    <p>128-block safety depth is not a finality guarantee. Counts include mixed historical Blockscout/RPC observations; individual rows have no source attribution.</p>
    <p>Last indexed is the accepted scan time, not the latest transfer event time. Continuous observation exposure is unverified.</p>
  </div>;
  const progress = coverage?.cycleProgressPct;
  const known = progress != null && Number.isFinite(progress);
  const width = known ? Math.min(100, Math.max(0, progress)) : 0;
  return <>
    <div>
      <span className="scope-label">OBSERVATION COVERAGE</span>
      <strong>{known ? `${progress}% of current rotation` : "Current rotation unknown"}</strong>
      <p>{coverage?.completedCycles ?? "Unknown"} prior completed rotations · {coverage?.scannedInCycle ?? "?"} of {coverage?.trackedTokens ?? "?"} tokens in the current cycle; rotation progress is not scan completeness.</p>
      <p>{coverage?.observedTokensInWindow ?? "Unknown"} of {coverage?.trackedTokens ?? "Unknown"} canonical tokens with observed transfers in this window.</p>
      {coverage?.observationExposureVerified !== true && <p>Continuous observation exposure is unverified.</p>}
    </div>
    <div className="coverage-track" role="progressbar" aria-label="Current registry rotation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? width : undefined} aria-valuetext={known ? `${progress}% of current rotation` : "Unknown"}>
      <span style={{ width: `${width}%` }} />
    </div>
  </>;
}
