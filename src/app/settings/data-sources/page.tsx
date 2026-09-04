"use client";

import { useEffect, useState } from "react";

type SourceHealth = {
  name: string;
  url: string;
  status: string;
  lastSuccessAt: string | null;
  lastError: string | null;
};

const sourceNotes: Record<string, string> = {
  "Robinhood Assets API": "Canonical asset identity and contract registry.",
  "Blockscout Chain Stats": "Chain-wide block, transaction, address, and utilization snapshot.",
  "Blockscout Gas Price": "Slow, standard, and fast suggested prices in Gwei per gas unit. Stored separately so a lagging block total cannot suppress a newer gas observation.",
  "Blockscout Token Transfers": "Page-bounded transfer observations for rotating canonical-token batches.",
  Database: "Operational source of truth shared by the indexer and dashboard.",
};

function relativeTime(value: string | null) {
  if (!value) return "No successful observation yet";
  const delta = Date.now() - new Date(value).getTime();
  if (delta < 60_000) return "Less than a minute ago";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} minutes ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} hours ago`;
  return new Date(value).toLocaleString();
}

export default function DataSourcesPage() {
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    fetch("/api/v1/source-health")
      .then((response) => response.json())
      .then((payload) => {
        setSources(payload.data?.sources || []);
        setStatus(payload.data?.overallStatus || "unknown");
      })
      .catch(() => setStatus("unavailable"));
  }, []);

  return (
    <div className="page-shell">
      <header className="section-hero">
        <div><p className="eyebrow">PROVENANCE & FRESHNESS</p><h1>Data Sources</h1><p>What Robin collects, where it comes from, and how recently each source was observed.</p></div>
        <div className="registry-count"><span className={`status-dot ${status === "healthy" ? "status-dot-live" : "status-dot-warn"}`} /><strong className="source-status-word">{status}</strong></div>
      </header>

      <section className="source-grid">
        {sources.map((source) => (
          <article className="source-card" key={source.name}>
            <div className="source-card-head"><span className={`status-dot ${source.status === "healthy" ? "status-dot-live" : "status-dot-warn"}`} /><span>{source.status}</span></div>
            <h2>{source.name}</h2>
            <p>{sourceNotes[source.name] || "Operational data source."}</p>
            <dl><div><dt>Last success</dt><dd>{relativeTime(source.lastSuccessAt)}</dd></div><div><dt>Endpoint</dt><dd>{source.url}</dd></div></dl>
            {source.lastError && <div className="source-error">{source.lastError}</div>}
          </article>
        ))}
      </section>

      <section className="methodology-card source-method">
        <div><span>COLLECTION</span><strong>Bounded by design</strong><p>Tokens rotate across runs and active tokens receive additional observation. This controls free API usage.</p></div>
        <div><span>STORAGE</span><strong>Raw evidence first</strong><p>Transaction hash, log index, addresses, block, amount, and timestamp are stored before aggregation.</p></div>
        <div><span>INTERPRETATION</span><strong>No synthetic activity</strong><p>Missing values remain unavailable. Activity Index is descriptive, relative, and fully documented.</p></div>
      </section>
    </div>
  );
}
