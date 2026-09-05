"use client";

import { useEffect, useState } from "react";
import type { ActivityTokenRow } from "@/lib/queries";

const WINDOWS = ["1h", "6h", "24h"];

type LensMeta = {
  status?: "active-limited" | "withheld";
  release?: { coveragePct: number; reasons: string[] };
  observationBoundary?: string;
  meaning?: string;
  lastUpdatedAt?: string;
};

function compact(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function momentum(value: number | null) {
  if (value == null) return "New";
  return `${value > 0 ? "+" : ""}${value.toFixed(0)}%`;
}

export default function ActivityLensPage() {
  const [window, setWindow] = useState("24h");
  const [tokens, setTokens] = useState<ActivityTokenRow[]>([]);
  const [meta, setMeta] = useState<LensMeta>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/v1/opportunities?window=${window}`)
      .then((response) => {
        if (!response.ok) throw new Error("Activity Lens request failed");
        return response.json();
      })
      .then((payload) => {
        setTokens(Array.isArray(payload.data) ? payload.data : []);
        setMeta(payload.meta ?? {});
      })
      .catch(() => {
        setTokens([]);
        setMeta({ status: "withheld", release: { coveragePct: 0, reasons: ["Current activity data is unavailable"] } });
      })
      .finally(() => setLoading(false));
  }, [window]);

  const active = meta.status === "active-limited";

  return (
    <div className="page-shell">
      <header className="section-hero">
        <div>
          <p className="eyebrow">DESCRIPTIVE ACTIVITY · {active ? "LIVE" : "CHECKING"}</p>
          <h1>Activity Lens</h1>
          <p>See where observed Robinhood Chain token activity is concentrated, then inspect the underlying evidence.</p>
        </div>
        <div className="window-tabs">
          {WINDOWS.map((item) => (
            <button
              key={item}
              className={window === item ? "active" : ""}
              aria-pressed={window === item}
              onClick={() => {
                if (item !== window) {
                  setLoading(true);
                  setWindow(item);
                }
              }}
            >{item}</button>
          ))}
        </div>
      </header>

      <section className="methodology-card">
        <div><span>01</span><strong>Observed transfers · 60%</strong><p>Relative event count inside the selected window.</p></div>
        <div><span>02</span><strong>Observed addresses · 40%</strong><p>Unique senders and recipients, including contracts.</p></div>
        <div><span>03</span><strong>Window delta</strong><p>Transfer-event change versus the immediately preceding window.</p></div>
      </section>

      <section className="scope-banner compact-scope">
        <div><span className="scope-label">RELEASE STATUS</span><strong>{loading ? "Checking current index" : active ? "Limited observation ranking active" : "Temporarily withheld"}</strong></div>
        <div className="coverage-track"><span style={{ width: `${meta.release?.coveragePct ?? 0}%` }} /></div>
        <p className="scope-note">{meta.observationBoundary ?? "The gate requires a recent successful index, a completed registry rotation, and at least 95% stored-transfer coverage."}</p>
      </section>

      <section className="panel leaders-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">RELATIVE OBSERVED ACTIVITY</p>
            <h2>Activity leaders</h2>
            <p>Scores are normalized within this window. They are not comparable across windows and do not measure price direction.</p>
          </div>
          <span className="method-chip">{loading ? "Loading" : active ? `${tokens.length} observed assets` : "Gate closed"}</span>
        </div>

        {active && tokens.length > 0 ? (
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
                  <div><dt>Window Δ</dt><dd className={token.momentumPct != null && token.momentumPct < 0 ? "negative" : "positive"}>{momentum(token.momentumPct)}</dd></div>
                </dl>
                <ul>{token.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">{loading ? "Loading current observations…" : meta.release?.reasons?.join(" · ") || "No indexed activity for this window."}</div>
        )}
      </section>

      <footer className="method-footer"><strong>Interpretation boundary:</strong> {meta.meaning ?? "This lens describes page-bounded onchain observations. It is not an investment recommendation."}</footer>
    </div>
  );
}
