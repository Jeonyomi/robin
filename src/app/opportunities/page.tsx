import Link from "next/link";

export default function ActivityLensPage() {
  return (
    <div className="page-shell">
      <header className="section-hero">
        <div>
          <p className="eyebrow">COMPARATIVE ANALYSIS · WITHHELD</p>
          <h1>Activity Lens</h1>
          <p>Cross-token ranking and momentum are not published until collection exposure can be compared fairly.</p>
        </div>
      </header>

      <section className="panel comparison-withheld">
        <span className="method-chip">Fail-closed release gate</span>
        <h2>Why scores are paused</h2>
        <p>Transfers are collected through bounded rotating batches, while recently active tokens can be revisited more often. A page limit can also truncate busy tokens. Raw counts therefore do not yet support a fair cross-token score.</p>
        <div className="methodology-card comparison-gates">
          <div><span>01</span><strong>Comparable exposure</strong><p>Track when and how deeply each token was observed.</p></div>
          <div><span>02</span><strong>Explicit truncation</strong><p>Mark page-capped results instead of treating them as complete.</p></div>
          <div><span>03</span><strong>Complete comparison windows</strong><p>Publish momentum only when current and prior windows have equivalent coverage.</p></div>
        </div>
        <Link className="text-link" href="/capital-flow">Inspect raw transfer evidence →</Link>
      </section>

      <footer className="method-footer"><strong>Release rule:</strong> No risk, opportunity, smart-money, buy/sell, or price-direction signal is generated from this transfer sample.</footer>
    </div>
  );
}
