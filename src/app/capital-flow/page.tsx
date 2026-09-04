"use client";

import { useEffect, useState } from "react";
import { ActivityTimelineChart } from "@/components/charts/activity-timeline";
import type { OverviewData } from "@/lib/queries";

const WINDOWS = ["1h", "6h", "24h", "7d"];

function compact(value: number | null | undefined) {
  if (value == null) return "Not observed";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function relativeTime(value: string | null | undefined) {
  if (!value) return "Not indexed";
  const delta = Date.now() - new Date(value).getTime();
  if (delta < 60_000) return "<1m ago";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(value).toLocaleString();
}

export default function TransferActivityPage() {
  const [window, setWindow] = useState("24h");
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/v1/capital-flow?window=${window}`)
      .then((response) => response.json())
      .then((payload) => {
        if (!payload.data?.activity || !payload.data?.coverage) throw new Error("No current observation is available");
        setData(payload.data);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [window]);

  return (
    <div className="page-shell">
      <header className="section-hero">
        <div>
          <p className="eyebrow">RAW ONCHAIN OBSERVATIONS</p>
          <h1>Transfer Activity</h1>
          <p>Canonical-token movements indexed from Blockscout. No inferred DEX direction or fabricated USD flow.</p>
        </div>
        <div className="window-tabs">
          {WINDOWS.map((item) => <button key={item} className={window === item ? "active" : ""} onClick={() => setWindow(item)}>{item}</button>)}
        </div>
      </header>

      <section className="metric-grid metric-grid-five">
        <div className="metric-block"><p className="metric-label">TRANSFERS</p><p className="metric-value">{compact(data?.activity.transferEvents)}</p><p className="metric-note">Stored events / {window}</p></div>
        <div className="metric-block"><p className="metric-label">ADDRESSES</p><p className="metric-value">{compact(data?.activity.activeAddresses)}</p><p className="metric-note">Unique participants</p></div>
        <div className="metric-block"><p className="metric-label">TOKENS</p><p className="metric-value">{compact(data?.activity.activeTokens)}</p><p className="metric-note">Observed in window</p></div>
        <div className="metric-block"><p className="metric-label">MINT EVENTS</p><p className="metric-value">{compact(data?.activity.mintEvents)}</p><p className="metric-note">From zero address</p></div>
        <div className="metric-block"><p className="metric-label">BURN EVENTS</p><p className="metric-value">{compact(data?.activity.burnEvents)}</p><p className="metric-note">To zero address</p></div>
      </section>

      <section className="scope-banner compact-scope">
        <div><span className="scope-label">SCOPE</span><strong>{(data?.coverage.completedCycles ?? 0) > 0 ? "Full initial registry coverage" : `${data?.coverage.cycleProgressPct ?? 0}% initial coverage`}</strong></div>
        <div className="coverage-track"><span style={{ width: `${(data?.coverage.completedCycles ?? 0) > 0 ? 100 : data?.coverage.cycleProgressPct ?? 0}%` }} /></div>
        <p className="scope-note">Last indexed {relativeTime(data?.coverage.lastIndexedAt)}. {data?.dataQuality.note}</p>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><p className="section-kicker">HOURLY VIEW</p><h2>Transfer events and unique addresses</h2></div><span className="method-chip">{loading ? "Loading" : "Observed"}</span></div>
        <ActivityTimelineChart data={data?.timeline ?? []} />
      </section>

      <section className="panel leaders-panel">
        <div className="panel-heading"><div><p className="section-kicker">TOKEN COMPARISON</p><h2>Most active tracked assets</h2><p>Activity Index is relative within this result set: 60% transfer count, 40% unique addresses.</p></div></div>
        <div className="transfer-table-wrap">
          <table className="data-table">
            <thead><tr><th>Asset</th><th>Activity index</th><th>Transfers</th><th>Addresses</th><th>vs prior window</th><th>Latest block</th></tr></thead>
            <tbody>
              {(data?.topTokens ?? []).map((token) => (
                <tr key={token.address}>
                  <td><strong>{token.symbol || "Unknown"}</strong><small className="table-sub">{token.name || shortAddress(token.address)}</small></td>
                  <td><span className="score-cell"><i style={{ width: `${token.activityIndex}%` }} /> <b>{token.activityIndex}</b></span></td>
                  <td>{token.transferCount.toLocaleString()}</td>
                  <td>{token.activeAddresses.toLocaleString()}</td>
                  <td>{token.momentumPct == null ? "Newly observed" : `${token.momentumPct > 0 ? "+" : ""}${token.momentumPct.toFixed(0)}%`}</td>
                  <td><a href={`https://robinhoodchain.blockscout.com/block/${token.latestBlock}`} target="_blank" rel="noreferrer">{token.latestBlock.toLocaleString()} ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.topTokens?.length && <div className="empty-state">No activity observed in this window.</div>}
        </div>
      </section>

      <section className="panel recent-panel">
        <div className="panel-heading"><div><p className="section-kicker">EVIDENCE LOG</p><h2>Recent transfers</h2></div></div>
        <div className="transfer-table-wrap">
          <table className="data-table">
            <thead><tr><th>Time</th><th>Token</th><th>Event</th><th>From</th><th>To</th><th>Amount</th><th>Transaction</th></tr></thead>
            <tbody>
              {(data?.recentTransfers ?? []).map((transfer) => (
                <tr key={`${transfer.txHash}:${transfer.logIndex}`}>
                  <td>{relativeTime(transfer.timestamp)}</td>
                  <td><strong>{transfer.symbol || shortAddress(transfer.tokenAddress)}</strong></td>
                  <td><span className={`event-pill event-${transfer.kind}`}>{transfer.kind}</span></td>
                  <td className="mono">{shortAddress(transfer.fromAddress)}</td>
                  <td className="mono">{shortAddress(transfer.toAddress)}</td>
                  <td>{transfer.normalizedValue == null ? "Not parsed" : compact(transfer.normalizedValue)}</td>
                  <td><a href={`https://robinhoodchain.blockscout.com/tx/${transfer.txHash}`} target="_blank" rel="noreferrer">{shortAddress(transfer.txHash)} ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
