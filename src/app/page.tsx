"use client";

import { useState } from "react";
import { useObservation } from "@/lib/hooks/use-observation";
import { CurrentRotation, ObservationFreshness } from "@/components/observation-status";
import { observationStatus } from "@/lib/observation-status";
import Link from "next/link";
import { ActivityTimelineChart } from "@/components/charts/activity-timeline";
import type { OverviewData } from "@/lib/queries";

const WINDOWS = ["1h", "6h", "24h"];

function selectOverview(payload: unknown): OverviewData {
  const { data } = payload as { data?: OverviewData };
  if (!data?.activity || !data?.coverage) throw new Error("No current observation is available");
  return data;
}

function compact(value: number | null | undefined) {
  if (value == null) return "Not observed";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function gasPrice(value: number | null | undefined) {
  if (value == null) return "Not observed";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

function relativeTime(value: string | null | undefined) {
  const status = observationStatus(value);
  if (status.status === "unknown" || status.status === "future") return status.label;
  return new Date(value!).toISOString();
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
  const { data, loading, error } = useObservation(`/api/v1/overview?window=${window}`, selectOverview);

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
            <span>Transfer index result</span>
            <strong>{data?.coverage.status ?? "checking"}</strong>
          </div>
          <ObservationFreshness data={data} />
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
              note="Standard · per gas unit · See Observation freshness for gas age."
            />
          </section>

          <section className="scope-banner">
            <CurrentRotation coverage={data?.coverage} />
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
                Blockscout suggested price per gas unit. See Observation freshness for gas age. Actual transaction fee depends on gas used and effective gas price; no USD estimate is implied.
              </p>
              <dl className="chain-list">
                <div><dt>Indexed block count</dt><dd>{compact(data?.chain?.totalBlocks)}</dd></div>
                <div><dt>Total addresses</dt><dd>{compact(data?.chain?.totalAddresses)}</dd></div>
                <div><dt>Average block time</dt><dd>{data?.chain?.averageBlockTimeMs != null ? `${data.chain.averageBlockTimeMs.toFixed(0)} ms` : "Not observed"}</dd></div>
                <div><dt>Latest tracked block</dt><dd>{data?.activity.latestBlock?.toLocaleString() ?? "Not observed"}</dd></div>
              </dl>
              <a className="text-link" href="https://robinhoodchain.blockscout.com" target="_blank" rel="noreferrer">Open source explorer ↗</a>
            </article>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">DESCRIPTIVE ACTIVITY</p>
                <h2>Activity Lens is live</h2>
                <p>Compare page-bounded transfer events and unique addresses across tracked canonical tokens. Rankings are descriptive lower-bound observations, not price or trade signals.</p>
              </div>
              <Link className="text-link" href="/opportunities">Open Activity Lens →</Link>
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
