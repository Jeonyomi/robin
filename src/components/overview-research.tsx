import Link from "next/link";
import "./overview-research.css";

export function OverviewResearch() {
  return (
    <section className="overview-research-section" aria-labelledby="overview-research-heading">
      <header className="overview-research-header">
        <p className="section-kicker">RESEARCH WORKSPACES</p>
        <h2 id="overview-research-heading">Explore liquidity &amp; meme activity</h2>
        <p>Product capabilities, not a live market snapshot.</p>
      </header>
      <div className="overview-research-grid">
        <article className="panel overview-research-card" aria-labelledby="overview-research-pairs">
          <h3 id="overview-research-pairs">Meme / Stock Pairs</h3>
          <p className="overview-research-summary">
            Discover candidate pairs, then inspect actual onchain v3/v4 pool state and related LP positions.
          </p>
          <p className="overview-research-coverage">
            <strong>Coverage:</strong> Related-position discovery samples up to 8 NFTs; an empty sample does not prove a pool has no LP positions.
          </p>
          <Link className="text-link overview-research-link" href="/liquidity#stock-pairs" prefetch={false}>
            Explore pairs <span aria-hidden="true">→</span>
          </Link>
        </article>
        <article className="panel overview-research-card" aria-labelledby="overview-research-lp">
          <h3 id="overview-research-lp">LP Leaders</h3>
          <p className="overview-research-summary">
            Compare supported LP NFTs by lifetime recorded WETH fee entitlement, then review range, inventory and fee evidence.
          </p>
          <p className="overview-research-coverage">
            <strong>Coverage:</strong> A bounded sample of observed positions, not a chain-wide leaderboard or realized profit. Unsampled positions may rank higher.
          </p>
          <Link className="text-link overview-research-link" href="/liquidity#lp-leaders" prefetch={false}>
            Review LP positions <span aria-hidden="true">→</span>
          </Link>
        </article>
        <article className="panel overview-research-card" aria-labelledby="overview-research-meme">
          <h3 id="overview-research-meme">Meme Leaders</h3>
          <p className="overview-research-summary">
            Explore token candidates in provider trending order, with a Source-tagged filter for provider meme-related categories.
          </p>
          <p className="overview-research-coverage">
            <strong>Coverage:</strong> Provider first page, up to 20 pools, deduplicated by base-token contract. Source tagging is not an authenticity or safety assurance.
          </p>
          <Link className="text-link overview-research-link" href="/meme-leaders" prefetch={false}>
            Explore meme candidates <span aria-hidden="true">→</span>
          </Link>
        </article>
      </div>
      <p className="overview-research-sequence">
        <strong>Suggested sequence:</strong> Pair discovery → pool evidence → LP position review
      </p>
    </section>
  );
}
