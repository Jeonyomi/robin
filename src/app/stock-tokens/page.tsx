"use client";

import { useMemo, useState } from "react";
import { useObservation } from "@/lib/hooks/use-observation";
import { observationStatus } from "@/lib/observation-status";

type StockToken = {
  address: string;
  symbol: string;
  name: string | null;
  canonicalStatus: string;
  canonicalAsset: { multiplier: string | null; status: string } | null;
  metrics: { holderCount: number | null; holderDelta: number | null; dataCompleteness: number | null } | null;
  lastSeenAt: string | null;
};

const EMPTY_TOKENS: StockToken[] = [];
function selectTokens(payload: unknown): StockToken[] {
  const { data } = payload as { data?: StockToken[] };
  return Array.isArray(data) ? data : [];
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function relativeTime(value: string | null | undefined) {
  const status = observationStatus(value);
  if (status.status === "unknown" || status.status === "future") return status.label;
  return new Date(value!).toISOString();
}

export default function AssetRegistryPage() {
  const [canonicalOnly, setCanonicalOnly] = useState(true);
  const [query, setQuery] = useState("");

  const { data, loading, error } = useObservation(`/api/v1/stock-tokens?canonicalOnly=${canonicalOnly}`, selectTokens);
  const tokens = data ?? EMPTY_TOKENS;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...tokens]
      .filter((token) => !needle || token.symbol?.toLowerCase().includes(needle) || token.name?.toLowerCase().includes(needle) || token.address.includes(needle))
      .sort((a, b) => (b.metrics?.holderCount ?? -1) - (a.metrics?.holderCount ?? -1));
  }, [tokens, query]);

  return (
    <div className="page-shell">
      <header className="section-hero">
        <div>
          <p className="eyebrow">CANONICAL IDENTITY</p>
          <h1>Asset Registry</h1>
          <p>Robinhood&apos;s asset registry matched to Blockscout contract metadata and holder observations.</p>
        </div>
        <div className="registry-count"><strong>{tokens.length}</strong><span>tracked assets</span></div>
      </header>

      <section className="registry-controls">
        <label className="search-field"><span>Search</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Symbol, name, or contract" /></label>
        <label className="check-field"><input type="checkbox" checked={canonicalOnly} onChange={(event) => setCanonicalOnly(event.target.checked)} /> Canonical only</label>
      </section>

      <section className="panel registry-panel">
        <div className="panel-heading"><div><p className="section-kicker">SOURCE-MATCHED ASSETS</p><h2>{visible.length} results</h2></div><span className="method-chip">{loading ? "Refreshing" : error ? "Unavailable" : "Robinhood + Blockscout"}</span></div>
        <div className="transfer-table-wrap" role="region" aria-label="Asset registry results" tabIndex={0}>
          <table className="data-table">
            <thead><tr><th>Asset</th><th>Registry status</th><th>Holders</th><th>Holder change</th><th>Data coverage</th><th>Metadata observed</th><th>Contract</th></tr></thead>
            <tbody>
              {visible.map((token) => (
                <tr key={token.address}>
                  <td><strong>{token.symbol}</strong><small className="table-sub">{token.name || "Unnamed token"}</small></td>
                  <td><span className={`event-pill ${token.canonicalStatus === "CANONICAL" ? "event-mint" : "event-burn"}`}>{token.canonicalStatus === "CANONICAL" ? "canonical" : token.canonicalStatus.toLowerCase()}</span></td>
                  <td>{token.metrics?.holderCount?.toLocaleString() ?? "Not observed"}</td>
                  <td className={(token.metrics?.holderDelta ?? 0) > 0 ? "positive" : (token.metrics?.holderDelta ?? 0) < 0 ? "negative" : ""}>{token.metrics?.holderDelta == null ? "Not observed" : `${token.metrics.holderDelta > 0 ? "+" : ""}${token.metrics.holderDelta.toLocaleString()}`}</td>
                  <td>{token.metrics?.dataCompleteness == null ? "Not observed" : `${Math.round(token.metrics.dataCompleteness * 100)}%`}</td>
                  <td>{relativeTime(token.lastSeenAt)}</td>
                  <td><a className="mono" href={`https://robinhoodchain.blockscout.com/token/${token.address}`} target="_blank" rel="noreferrer">{shortAddress(token.address)} ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
          {error && <div className="empty-state" role="alert">Current registry data is unavailable.</div>}
          {!loading && !error && visible.length === 0 && <div className="empty-state">No assets match this filter.</div>}
        </div>
      </section>

      <footer className="method-footer"><strong>Canonical</strong> means the contract address exactly matches Robinhood&apos;s public asset registry. Holder values are point-in-time Blockscout observations and can be unavailable.</footer>
    </div>
  );
}
