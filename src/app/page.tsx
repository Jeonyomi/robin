"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ActivityTimelineChart } from "@/components/charts/activity-timeline";
import type { OverviewData } from "@/lib/queries";

const WINDOWS = ["1h", "6h", "24h", "7d"];

function compact(value: number | null | undefined) {
  if (value == null) return "Not observed";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
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

  const hasObservations = Boolean(data?.activity?.transferEvents);

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
            <button key={item} className={window === item ? "active" : ""} onClick={() => setWindow(item)}>
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
          <section className="metric-grid" aria-label="Observed activity summary">
            <Metric label="TRANSFER EVENTS" value={compact(data?.activity.transferEvents)} note={`Stored observations / ${window}`} />
            <Metric label="ACTIVE ADDRESSES" value={compact(data?.activity.activeAddresses)} note="Unique senders and recipients" />
            <Metric label="ACTIVE TOKENS" value={compact(data?.activity.activeTokens)} note={`Of ${compact(data?.coverage.trackedTokens)} tracked canonical assets`} />
            <Metric label="CHAIN TRANSACTIONS" value={compact(data?.chain?.totalTransactions)} note="Chain-wide / Blockscout" />
          </section>

          <section className="scope-banner">
            <div>
              <span className="scope-label">OBSERVATION COVERAGE</span>
              <strong>{(data?.coverage.completedCycles ?? 0) > 0 ? "Full initial registry coverage" : `${data?.coverage.cycleProgressPct ?? 0}% of initial rotation`}</strong>
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
                  <p className="section-kicker">CHAIN STATE</p>
                  <h2>Public network snapshot</h2>
                </div>
              </div>
              <dl className="chain-list">
                <div><dt>Block height</dt><dd>{compact(data?.chain?.totalBlocks)}</dd></div>
                <div><dt>Total addresses</dt><dd>{compact(data?.chain?.totalAddresses)}</dd></div>
                <div><dt>Average block time</dt><dd>{data?.chain?.averageBlockTimeMs != null ? `${data.chain.averageBlockTimeMs.toFixed(0)} ms` : "Not observed"}</dd></div>
                <div><dt>Fast gas</dt><dd>{data?.chain?.gasPricesGwei?.fast != null ? `${data.chain.gasPricesGwei.fast} Gwei` : "Not observed"}</dd></div>
                <div><dt>Latest tracked block</dt><dd>{data?.activity.latestBlock?.toLocaleString() ?? "Not observed"}</dd></div>
              </dl>
              <a className="text-link" href="https://robinhoodchain.blockscout.com" target="_blank" rel="noreferrer">Open source explorer ↗</a>
            </article>
          </section>

          <section className="panel leaders-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">ACTIVITY LENS</p>
                <h2>Tokens drawing observable attention</h2>
                <p>Ranked only by transfer count and unique addresses within the selected window.</p>
              </div>
              <Link className="text-link" href="/opportunities">View methodology and all leaders →</Link>
            </div>

            {!hasObservations ? (
              <div className="empty-state">No stored transfers in this window. Run the transfer indexer or choose a wider window.</div>
            ) : (
              <div className="leader-list">
                {data?.topTokens.slice(0, 6).map((token, index) => (
                  <Link href={`/tokens/${token.address}`} className="leader-row" key={token.address}>
                    <span className="leader-rank">{String(index + 1).padStart(2, "0")}</span>
                    <span className="leader-asset"><strong>{token.symbol || "Unknown"}</strong><small>{token.name || address(token.address)}</small></span>
                    <span className="leader-evidence"><strong>{compact(token.transferCount)} transfers</strong><small>{compact(token.activeAddresses)} addresses · {token.evidence[1]}</small></span>
                    <span className="leader-index"><small>Activity index</small><strong>{token.activityIndex}</strong></span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="panel recent-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">RAW EVIDENCE</p>
                <h2>Latest indexed transfers</h2>
              </div>
              <Link className="text-link" href="/capital-flow">Explore transfer activity →</Link>
            </div>
            <div className="transfer-table-wrap">
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
            <strong>Reading rule:</strong> Activity is not demand, transfer count is not volume, and this dashboard is not investment advice. Every number is labeled by scope and source.
          </footer>
        </>
      )}
    </div>
  );
}
