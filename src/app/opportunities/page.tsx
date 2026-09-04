"use client";

import { useEffect, useState } from "react";

type ActivityToken = {
  address: string;
  symbol: string | null;
  name: string | null;
  transferCount: number;
  previousTransferCount: number;
  activeAddresses: number;
  momentumPct: number | null;
  holderCount: number | null;
  holderDelta: number | null;
  latestBlock: number;
  lastTransferAt: string;
  activityIndex: number;
  evidence: string[];
};

const WINDOWS = ["1h", "6h", "24h", "7d"];

function compact(value: number | null) {
  if (value == null) return "Not observed";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export default function ActivityLensPage() {
  const [window, setWindow] = useState("24h");
  const [tokens, setTokens] = useState<ActivityToken[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/v1/opportunities?window=${window}`)
      .then((response) => response.json())
      .then((payload) => setTokens(payload.data || []))
      .finally(() => setLoading(false));
  }, [window]);

  return (
    <div className="page-shell">
      <header className="section-hero">
        <div>
          <p className="eyebrow">DESCRIPTIVE ANALYSIS</p>
          <h1>Activity Lens</h1>
          <p>Find where onchain attention is concentrated, then inspect the evidence. This is not a price forecast or buy signal.</p>
        </div>
        <div className="window-tabs">
          {WINDOWS.map((item) => <button key={item} className={window === item ? "active" : ""} onClick={() => setWindow(item)}>{item}</button>)}
        </div>
      </header>

      <section className="methodology-card">
        <div><span>01</span><strong>Transfer count</strong><p>60% of the index, normalized to the most active token in this view.</p></div>
        <div><span>02</span><strong>Unique addresses</strong><p>40% of the index, reducing the weight of repetitive wallet activity.</p></div>
        <div><span>03</span><strong>Evidence</strong><p>Window-over-window change and holder observations are shown separately.</p></div>
      </section>

      <section className="panel leaders-panel">
        <div className="panel-heading">
          <div><p className="section-kicker">RELATIVE RANKING</p><h2>Observable token activity</h2><p>Scores are recalculated within each selected window and are not comparable across different windows.</p></div>
          <span className="method-chip">{loading ? "Loading" : `${tokens.length} observed assets`}</span>
        </div>
        <div className="activity-card-grid">
          {tokens.map((token, index) => (
            <article className="activity-card" key={token.address}>
              <div className="activity-card-top">
                <span className="leader-rank">{String(index + 1).padStart(2, "0")}</span>
                <span className="activity-score">{token.activityIndex}<small>/100</small></span>
              </div>
              <h3>{token.symbol || "Unknown"}</h3>
              <a href={`https://robinhoodchain.blockscout.com/token/${token.address}`} target="_blank" rel="noreferrer">{token.name || shortAddress(token.address)} ↗</a>
              <div className="score-track"><span style={{ width: `${token.activityIndex}%` }} /></div>
              <dl>
                <div><dt>Transfers</dt><dd>{compact(token.transferCount)}</dd></div>
                <div><dt>Addresses</dt><dd>{compact(token.activeAddresses)}</dd></div>
                <div><dt>Holders</dt><dd>{compact(token.holderCount)}</dd></div>
              </dl>
              <ul>{token.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          ))}
        </div>
        {!loading && tokens.length === 0 && <div className="empty-state">No indexed activity for this window yet.</div>}
      </section>

      <footer className="method-footer"><strong>Interpretation boundary:</strong> High activity can reflect transfers, issuance, redemptions, automation, or market activity. The index identifies where to investigate, not what to buy.</footer>
    </div>
  );
}
