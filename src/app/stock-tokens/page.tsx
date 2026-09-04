"use client";

import { useEffect, useMemo, useState } from "react";

type StockToken = {
  address: string;
  symbol: string;
  name: string | null;
  canonicalStatus: string;
  canonicalAsset: { multiplier: string | null; status: string } | null;
  metrics: { holderCount: number | null; holderDelta: number | null; dataCompleteness: number | null } | null;
  lastSeenAt: string;
};

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function relativeTime(value: string) {
  const delta = Date.now() - new Date(value).getTime();
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

export default function AssetRegistryPage() {
  const [tokens, setTokens] = useState<StockToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [canonicalOnly, setCanonicalOnly] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch(`/api/v1/stock-tokens?canonicalOnly=${canonicalOnly}`)
      .then((response) => response.json())
      .then((payload) => setTokens(payload.data || []))
      .finally(() => setLoading(false));
  }, [canonicalOnly]);

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
        <div className="panel-heading"><div><p className="section-kicker">SOURCE-MATCHED ASSETS</p><h2>{visible.length} results</h2></div><span className="method-chip">{loading ? "Refreshing" : "Robinhood + Blockscout"}</span></div>
        <div className="transfer-table-wrap">
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
          {!loading && visible.length === 0 && <div className="empty-state">No assets match this filter.</div>}
        </div>
      </section>

      <footer className="method-footer"><strong>Canonical</strong> means the contract address exactly matches Robinhood&apos;s public asset registry. Holder values are point-in-time Blockscout observations and can be unavailable.</footer>
    </div>
  );
}
