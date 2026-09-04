import Link from "next/link";

export default function WalletIntelligencePage() {
  return (
    <div className="page-shell">
      <header className="section-hero"><div><p className="eyebrow">RESEARCH MODULE · DISABLED</p><h1>Wallet Intelligence</h1><p>Robin does not label wallets as smart money without validated trade decoding, pricing, and attribution evidence.</p></div></header>
      <section className="panel disabled-module">
        <span className="method-chip">Not in operating path</span>
        <h2>Why this view is disabled</h2>
        <p>Raw token transfers do not prove a trade, realized PnL, ownership, or investment skill. Publishing a wallet score from transfer activity alone would overstate the evidence.</p>
        <ul><li>Decode swaps and protocol interactions</li><li>Establish timestamp-aligned execution prices</li><li>Separate routers, contracts, bots, and end users</li><li>Validate attribution and performance methodology</li></ul>
        <Link className="text-link" href="/capital-flow">Inspect current transfer evidence →</Link>
      </section>
    </div>
  );
}
