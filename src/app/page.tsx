"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ActivityTimelineChart } from "@/components/charts/activity-timeline";
import type { OverviewData } from "@/lib/queries";

const WINDOWS = ["1h", "6h", "24h"];

function compact(value: number | null | undefined) {
  if (value == null) return "Not observed";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function gasPrice(value: number | null | undefined) {
  if (value == null) return "Not observed";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

function relativeTime(value: string | null | undefined) {
  if (!value) return "Not indexed";
  const delta = Date.now() - new Date(value).getTime();
  if (delta < 60_000) return "less than a minute ago";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(value).toLocaleString();
}

function address(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="metric-block">
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      <p className="metric-note">{note}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [window, setWindow] = useState("24h");
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/overview?window=${window}`)
      .then((response) => {
        if (!response.ok) throw new Error("Overview request failed");
        return response.json();
      })
      .then((payload) => {
        if (!payload.data?.activity || !payload.data?.coverage) throw new Error("No current observation is available");
        setData(payload.data);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [window]);

  return (
    <div className="page-shell">
      <section className="hero-grid">
        <div>
          <p className="eyebrow">ROBIN / ONCHAIN OBSERVATORY</p>
          <h1 className="hero-title">What is moving on<br />Robinhood Chain?</h1>
          <p className="hero-copy">
            Public chain statistics and canonical-token transfers, collected from free endpoints and separated from interpretation.
          </p>
        </div>
        <div className="hero-status">
          <div className="status-line">
            <span className={`status-dot ${data?.coverage.status === "success" ? "status-dot-live" : "status-dot-warn"}`} />
            <span>Blockscout direct API</span>
            <strong>{data?.coverage.status ?? "checking"}</strong>
          </div>
          <div className="status-line">
            <span className="status-key">LAST INDEX</span>
            <strong>{relativeTime(data?.coverage.lastIndexedAt)}</strong>
          </div>
          <div className="status-line">
            <span className="status-key">METHOD</span>
            <strong>Bounded rotating sample</strong>
          </div>
        </div>
      </section>

      <div className="toolbar">
        <div className="window-tabs" aria-label="Observation window">
          {WINDOWS.map((item) => (
            <button key={item} className={window === item ? "active" : ""} aria-pressed={window === item} onClick={() => setWindow(item)}>
              {item}
            </button>
          ))}
        </div>
        <p>{loading ? "Refreshing observation…" : `Window ending ${relativeTime(data?.activity.lastObservedAt)}`}</p>
      </div>

      {error ? (
        <div className="empty-state">The latest observation could not be loaded. Check Data Sources for source health.</div>
      ) : (
        <>
          <section className="metric-grid metric-grid-five" aria-label="Observed activity and network gas summary">
            <Metric label="TRANSFER EVENTS" value={compact(data?.activity.transferEvents)} note={`Stored observations / ${window}`} />
            <Metric label="ACTIVE ADDRESSES" value={compact(data?.activity.activeAddresses)} note="Unique addresses, including contracts" />
            <Metric label="ACTIVE TOKENS" value={compact(data?.activity.activeTokens)} note={`Of ${compact(data?.coverage.trackedTokens)} tracked canonical assets`} />
            <Metric label="CHAIN TRANSACTIONS" value={compact(data?.chain?.totalTransactions)} note="Chain-wide / Blockscout" />
            <Metric
              label="SUGGESTED GAS"
              value={data?.gas?.averageGwei != null ? `${gasPrice(data.gas.averageGwei)} Gwei` : "Not observed"}
              note={`Standard · per gas unit · ${relativeTime(data?.gas?.updatedAt)}`}
            />
          </section>

          <section className="scope-banner">
            <div>
              <span className="scope-label">OBSERVATION COVERAGE</span>
              <strong>{(data?.coverage.completedCycles ?? 0) > 0 ? "Registry rotation completed" : `${data?.coverage.cycleProgressPct ?? 0}% of initial rotation`}</strong>
              <p>{data?.coverage.completedCycles ?? 0} full cycles · {data?.coverage.scannedInCycle ?? 0} of {data?.coverage.trackedTokens ?? 0} tokens in the current cycle.</p>
            </div>
            <div className="coverage-track" aria-label={`${data?.coverage.cycleProgressPct ?? 0}% coverage`}>
              <span style={{ width: `${(data?.coverage.completedCycles ?? 0) > 0 ? 100 : data?.coverage.cycleProgressPct ?? 0}%` }} />
            </div>
            <p className="scope-note">{data?.dataQuality.note ?? "Waiting for the first transfer-index cycle."}</p>
          </section>

          <section className="dashboard-grid">
            <article className="panel panel-wide">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">ACTIVITY OVER TIME</p>
                  <h2>Transfers and participating addresses</h2>
                </div>
                <span className="method-chip">Observed · not estimated</span>
              </div>
              <ActivityTimelineChart data={data?.timeline ?? []} />
            </article>

            <article className="panel chain-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">NETWORK COST · CHAIN STATE</p>
                  <h2>Gas &amp; network snapshot</h2>
                </div>
                <span className="method-chip">Suggested · not total fee</span>
              </div>
              <div className="gas-tier-grid" aria-label="Blockscout suggested gas prices">
                {([
                  ["Slow", data?.gas?.slowGwei],
                  ["Standard", data?.gas?.averageGwei],
                  ["Fast", data?.gas?.fastGwei],
                ] as const).map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{gasPrice(value)}</strong>
                    <small>{value == null ? "Unavailable" : "Gwei"}</small>
                  </div>
                ))}
              </div>
              <p className="gas-note">
                Blockscout suggested price per gas unit · updated {relativeTime(data?.gas?.updatedAt)}. Actual transaction fee depends on gas used and effective gas price; no USD estimate is implied.
              </p>
              <dl className="chain-list">
                <div><dt>Block height</dt><dd>{compact(data?.chain?.totalBlocks)}</dd></div>
                <div><dt>Total addresses</dt><dd>{compact(data?.chain?.totalAddresses)}</dd></div>
                <div><dt>Average block time</dt><dd>{data?.chain?.averageBlockTimeMs != null ? `${data.chain.averageBlockTimeMs.toFixed(0)} ms` : "Not observed"}</dd></div>
                <div><dt>Latest tracked block</dt><dd>{data?.activity.latestBlock?.toLocaleString() ?? "Not observed"}</dd></div>
              </dl>
              <a className="text-link" href="https://robinhoodchain.blockscout.com" target="_blank" rel="noreferrer">Open source explorer ↗</a>
            </article>
          </section>

          <section className="panel comparison-withheld">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">COMPARATIVE ANALYSIS</p>
                <h2>Ranking and momentum withheld</h2>
                <p>Tokens are collected through rotating and hot-token batches with page limits. Cross-token scores remain hidden until observation exposure and truncation can be compared fairly.</p>
              </div>
              <Link className="text-link" href="/opportunities">Read the release gate →</Link>
            </div>
          </section>

          <section className="panel recent-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">RAW EVIDENCE</p>
                <h2>Latest indexed transfer events</h2>
              </div>
              <Link className="text-link" href="/capital-flow">Explore transfer activity →</Link>
            </div>
            <div className="transfer-table-wrap" role="region" aria-label="Latest indexed transfer events" tabIndex={0}>
              <table className="data-table">
                <thead><tr><th>Token</th><th>Type</th><th>From</th><th>To</th><th>Block</th><th>Observed</th></tr></thead>
                <tbody>
                  {(data?.recentTransfers ?? []).slice(0, 8).map((transfer) => (
                    <tr key={`${transfer.txHash}:${transfer.logIndex}`}>
                      <td><strong>{transfer.symbol || address(transfer.tokenAddress)}</strong></td>
                      <td><span className={`event-pill event-${transfer.kind}`}>{transfer.kind}</span></td>
                      <td className="mono">{address(transfer.fromAddress)}</td>
                      <td className="mono">{address(transfer.toAddress)}</td>
                      <td><a href={`https://robinhoodchain.blockscout.com/tx/${transfer.txHash}`} target="_blank" rel="noreferrer">{transfer.blockNumber.toLocaleString()} ↗</a></td>
                      <td>{relativeTime(transfer.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data?.recentTransfers?.length && <div className="empty-state">No raw transfer evidence stored for this window.</div>}
            </div>
          </section>

          <footer className="method-footer">
            <strong>Reading rule:</strong> One row is an ERC-20 transfer event, not necessarily one transaction or one person. Activity is not demand, transfer count is not value, and this dashboard is not investment advice.
          </footer>
        </>
      )}
    </div>
  );
}
