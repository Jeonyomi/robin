"use client";

import { useState } from "react";
import { useObservation } from "@/lib/hooks/use-observation";
import { ObservationFreshness } from "@/components/observation-status";
import { observationStatus } from "@/lib/observation-status";
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

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function relativeTime(value: string | null | undefined) {
  const status = observationStatus(value);
  if (status.status === "unknown" || status.status === "future") return status.label;
  return new Date(value!).toISOString();
}

export default function TransferActivityPage() {
  const [window, setWindow] = useState("24h");
  const { data, loading, error } = useObservation(`/api/v1/capital-flow?window=${window}`, selectOverview);

  return (
    <div className="page-shell">
      <header className="section-hero">
        <div>
          <p className="eyebrow">RAW ONCHAIN OBSERVATIONS</p>
          <h1>Transfer Activity</h1>
          <p>Canonical-token movements from bounded RPC scans and historical Blockscout observations. No inferred DEX direction or fabricated USD flow.</p>
        </div>
        <div className="window-tabs">
          {WINDOWS.map((item) => <button key={item} className={window === item ? "active" : ""} aria-pressed={window === item} onClick={() => setWindow(item)}>{item}</button>)}
        </div>
      </header>

      {error && <div className="empty-state" role="alert">The latest observation could not be loaded. Check Data Sources for source health.</div>}

      <section className="metric-grid metric-grid-five">
        <div className="metric-block"><p className="metric-label">TRANSFER EVENTS</p><p className="metric-value">{compact(data?.activity.transferEvents)}</p><p className="metric-note">Stored ERC-20 logs / {window}</p></div>
        <div className="metric-block"><p className="metric-label">ADDRESSES</p><p className="metric-value">{compact(data?.activity.activeAddresses)}</p><p className="metric-note">Unique addresses, including contracts</p></div>
        <div className="metric-block"><p className="metric-label">TOKENS</p><p className="metric-value">{compact(data?.activity.activeTokens)}</p><p className="metric-note">Observed in window</p></div>
        <div className="metric-block"><p className="metric-label">MINT EVENTS</p><p className="metric-value">{compact(data?.activity.mintEvents)}</p><p className="metric-note">From zero address</p></div>
        <div className="metric-block"><p className="metric-label">BURN EVENTS</p><p className="metric-value">{compact(data?.activity.burnEvents)}</p><p className="metric-note">To zero address</p></div>
      </section>

      <section className="panel"><ObservationFreshness data={data} /></section>

      <section className="panel">
        <div className="panel-heading"><div><p className="section-kicker">HOURLY VIEW</p><h2>Transfer events and unique addresses</h2></div><span className="method-chip">{loading ? "Loading" : error ? "Unavailable" : "Observed"}</span></div>
        <ActivityTimelineChart data={data?.timeline ?? []} />
      </section>


      <section className="panel recent-panel">
        <div className="panel-heading"><div><p className="section-kicker">EVIDENCE LOG</p><h2>Recent transfer events</h2><p>Multiple events can belong to one transaction. Counts are not transaction, wallet-owner, or USD-flow counts.</p></div></div>
        <div className="transfer-table-wrap" role="region" aria-label="Recent transfer events" tabIndex={0}>
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
