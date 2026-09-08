"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { MemeLeader, MemeLeadersData } from "@/lib/meme-leaders";

const MAX_AGE = 5 * 60_000;
const EXPLORER = "https://robinhoodchain.blockscout.com";
type Sort = "trending" | "volume" | "liquidity" | "change";
const valid = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const money = (value: number | null, price = false) => !valid(value) ? "N/A" : new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: price ? value !== 0 && Math.abs(value) < 0.000001 ? "scientific" : "standard" : "compact",
  ...(price ? { maximumSignificantDigits: 6 } : { maximumFractionDigits: 2 }),
}).format(value);
const count = (value: number | null) => valid(value) ? new Intl.NumberFormat("en-US").format(value) : "N/A";
const time = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC") : "N/A";
const short = (value: string) => value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;

function safeUrl(value: string | null, hosts: string[]) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.port && hosts.includes(url.hostname) ? url.href : null; } catch { return null; }
}
function TokenIcon({ token }: { token: MemeLeader }) {
  const [failed, setFailed] = useState(false);
  const src = safeUrl(token.imageUrl, ["coin-images.coingecko.com", "assets.geckoterminal.com"]);
  return <span className="ml-icon" aria-hidden="true">{src && !failed ? <img src={src} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : (token.symbol || token.name || "?").slice(0, 2).toUpperCase()}</span>;
}
function Change({ value }: { value: number | null }) {
  return <span className={!valid(value) || value === 0 ? "ml-neutral" : value > 0 ? "ml-positive" : "ml-negative"}>{!valid(value) ? "N/A" : `${value > 0 ? "+" : ""}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}</span>;
}
function External({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}<span aria-hidden="true"> ↗</span></a>;
}
function Badge({ token }: { token: MemeLeader }) {
  return <span className={`ml-badge ${token.classification === "source-tagged" ? "ml-tagged" : ""}`}>{token.classification === "source-tagged" ? "Source-tagged" : "Candidate"}</span>;
}
function Metric({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}
function Details({ token, board }: { token: MemeLeader; board: MemeLeadersData }) {
  const poolUrl = safeUrl(token.sourceUrl, ["www.geckoterminal.com", "geckoterminal.com"]);
  const tokenUrl = safeUrl(token.tokenSourceUrl, ["www.geckoterminal.com", "geckoterminal.com"]);
  return <div className="ml-details" id={`ml-detail-${token.address}`}>
    <div className="ml-detail-heading"><div><p className="ml-eyebrow">REPRESENTATIVE POOL / SOURCE CONTEXT</p><h3>{token.poolName || "Pool name unavailable"}</h3></div><Badge token={token} /></div>
    <p className="ml-caption">Price, changes, volume, liquidity and swap counts describe this one observed pool, not totals across the token’s markets. Market cap and FDV are separate provider-reported valuations.</p>
    <dl className="ml-detail-grid">
      <Metric label="Token contract"><External href={`${EXPLORER}/address/${encodeURIComponent(token.address)}`}><code>{token.address}</code></External></Metric>
      <Metric label="Chosen pool identifier"><code>{token.poolId}</code></Metric>
      <Metric label="DEX / quote token">{token.dex || "N/A"} / {token.quoteSymbol || "N/A"}</Metric>
      <Metric label="Source ranks">Candidate #{count(token.rank)} · provider pool #{count(token.providerPoolRank)}</Metric>
      <Metric label="Market cap">{money(token.marketCapUsd)}</Metric>
      <Metric label="Fully diluted valuation (FDV)">{money(token.fdvUsd)}</Metric>
      <Metric label="24h buys / sells (pool)">{count(token.buys24h)} / {count(token.sells24h)}</Metric>
      <Metric label="Pool created">{time(token.poolCreatedAt)}</Metric>
      <Metric label="Provider-reported holders">{count(token.holders)}<small>Holder timestamp: {time(token.holdersUpdatedAt)}</small></Metric>
      <Metric label="Provider categories">{token.categories.length ? token.categories.join(" · ") : "No categories available"}<small>Metadata: {token.metadataStatus.replaceAll("-", " ")}</small></Metric>
      <Metric label="Source retrieved (not observation time)">{time(board.retrievedAt)}</Metric>
      <Metric label="Canonical stock registry retrieved">{time(board.registryRetrievedAt)}</Metric>
    </dl>
    <p className="ml-caption">A source tag is a provider category match, not an audit or endorsement. Untagged candidates may be utility or other non-meme tokens. Unknown holder freshness stays unknown.</p>
    <div className="ml-links">{poolUrl && <External href={poolUrl}>GeckoTerminal pool</External>}{tokenUrl && <External href={tokenUrl}>GeckoTerminal token</External>}<External href={`${EXPLORER}/address/${encodeURIComponent(token.address)}`}>Blockscout contract</External>{token.stockPaired && <a href="/liquidity#stock-pairs">Explore Meme / Stock Pairs →</a>}</div>
    {token.stockPaired && <p className="ml-caption">Stock-paired indicates a registry-matched stock counterpart in the observed pool. The separate pair-discovery page may not include this exact pool.</p>}
    <p className="ml-caption">Scope: {board.coverage}</p>
  </div>;
}

export default function MemeLeadersExplorer() {
  const [board, setBoard] = useState<MemeLeadersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const [retryUntil, setRetryUntil] = useState(0);
  const cooldown = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const [search, setSearch] = useState("");
  const [classification, setClassification] = useState("all");
  const [sort, setSort] = useState<Sort>("trending");
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (pending.current || Date.now() < cooldown.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true); setError(""); setBoard(null); setExpanded(null);
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch("/api/v1/meme-leaders", { cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        const retry = response.headers.get("Retry-After");
        const until = retry && /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : retry ? Date.parse(retry) : NaN;
        cooldown.current = Math.max(Date.now() + 30_000, Number.isFinite(until) ? until : 0);
        setRetryUntil(cooldown.current);
      }
      const body = await response.json() as { data: MemeLeadersData | null; error: unknown };
      if (!response.ok || body.error != null || !body.data || !Array.isArray(body.data.tokens)) {
        throw new Error(typeof body.error === "string" ? body.error : "The discovery source is unavailable. No ranked results are displayed.");
      }
      if (pending.current === controller && !controller.signal.aborted) { setBoard(body.data); setNow(Date.now()); }
    } catch (caught) {
      if (pending.current === controller) {
        cooldown.current = Math.max(cooldown.current, Date.now() + 30_000);
        setRetryUntil(cooldown.current);
        setError(controller.signal.aborted ? "The source request timed out. Please refresh after the cooldown." : caught instanceof Error ? caught.message : "Unable to retrieve candidates.");
        setNow(Date.now());
      }
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) { pending.current = null; setLoading(false); }
    }
  }, []);

  useEffect(() => {
    const startup = setTimeout(() => { setNow(Date.now()); void refresh(); }, 0);
    // Display clock only. No background requests or automatic retries.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const onVisible = () => setNow(Date.now());
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(startup); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); pending.current?.abort(); pending.current = null; };
  }, [refresh]);

  const fetched = board ? Date.parse(board.retrievedAt) : NaN;
  const fresh = !!board && Number.isFinite(fetched) && now >= fetched && now - fetched < MAX_AGE;
  const retrySeconds = Math.max(0, Math.ceil((retryUntil - now) / 1000));
  const term = search.trim().toLowerCase();
  const candidates = fresh && board ? board.tokens : [];
  const trending = candidates.map((token, index) => ({ token, index })).sort((a, b) => {
    const av = a.token.rank; const bv = b.token.rank;
    return !valid(av) ? !valid(bv) ? a.index - b.index : 1 : !valid(bv) ? -1 : av - bv || a.index - b.index;
  });
  const spotlight = trending.filter(({ token }) => classification === "all" || token.classification === "source-tagged");
  const rows = spotlight.filter(({ token }) => !term || [token.symbol, token.name, token.address, token.poolName, token.dex].some((value) => value.toLowerCase().includes(term))).sort((a, b) => {
    if (sort === "trending") return 0;
    const key = sort === "volume" ? "volume24hUsd" : sort === "liquidity" ? "liquidityUsd" : "change24hPct";
    const av = a.token[key]; const bv = b.token[key];
    return !valid(av) ? !valid(bv) ? 0 : 1 : !valid(bv) ? -1 : bv - av;
  });
  const tagged = candidates.filter((token) => token.classification === "source-tagged").length;

  return <div className="ml-shell">
    <header className="ml-hero"><div><p className="ml-eyebrow">06 / ROBINHOOD CHAIN / MARKET DISCOVERY</p><h1>Meme Leaders<span>.</span></h1><p>Follow the attention. Inspect the market.<br />Trending token candidates, with the source and liquidity in view.</p></div><div className="ml-hero-note"><span aria-hidden="true">↗</span><strong>Activity, not a promise.</strong><small>Public data · read-only · no wallet</small></div></header>
    <div className="ml-basis"><strong>Trending does not mean price is rising.</strong> This is a bounded GeckoTerminal discovery list, not a whole-chain leaderboard or a token endorsement. “Candidate” does not establish that a token is a meme.</div>

    {fresh && spotlight.length > 0 && <section className="ml-spotlight" aria-label="First three tokens in the selected classification, in source trending order"><div className="ml-spotlight-heading"><p className="ml-eyebrow">AT A GLANCE / SOURCE TRENDING ORDER</p><span>{classification === "source-tagged" ? "Source-tagged only" : "All candidates"} · before search and sort · one pool per token</span></div><div className="ml-top-grid">{spotlight.slice(0, 3).map(({ token }) => <article className="ml-top-card" key={token.address}><div className="ml-top-identity"><span className="ml-top-rank">#{count(token.rank)}</span><TokenIcon token={token} /><div><h2>{token.symbol || "Unknown"}</h2><p>{token.name || short(token.address)}</p></div></div><div className="ml-top-price"><strong>{money(token.priceUsd, true)}</strong><span>24h <Change value={token.change24hPct} /></span></div><div className="ml-top-bottom"><Badge token={token} /><span>Pool volume <b>{money(token.volume24hUsd)}</b></span></div></article>)}</div></section>}

    <section className="ml-panel" aria-labelledby="ml-list-title" aria-busy={loading}>
      <div className="ml-toolbar"><div><p className="ml-eyebrow">THE OBSERVED MARKET</p><h2 id="ml-list-title">Trending candidates</h2><p>Up to 20 unique token addresses · one representative pool per token</p></div><button className="ml-refresh" type="button" disabled={loading || retrySeconds > 0} onClick={() => void refresh()}>{loading ? "Fetching…" : retrySeconds > 0 ? `Retry in ${retrySeconds}s` : "Refresh source ↻"}</button></div>
      <div className="ml-status" role="status"><span className={`ml-status-dot ${fresh ? "ml-is-fresh" : ""}`} aria-hidden="true" />{loading ? "Retrieving source snapshot" : fresh ? "Within 5-minute fetch window" : board ? "Expired snapshot · ranked results withheld" : "No current source snapshot"}<span>Manual refresh only · no background polling</span></div>
      {board && <p className="ml-source-time">Retrieved: <time dateTime={board.retrievedAt}>{time(board.retrievedAt)}</time>. Retrieval time is not the provider’s market observation time.</p>}
      {fresh && board && <div className="ml-summary"><span><b>{candidates.length}</b> candidates</span><span><b>{tagged}</b> source-tagged</span><span><b>{board.poolsObserved}</b> pools observed</span><span><b>{board.metadataRequested}</b> metadata requests</span></div>}
      <div className="ml-controls"><label className="ml-search">Search tokens<input type="search" placeholder="Name, symbol, address or DEX" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label>Classification<select value={classification} onChange={(event) => setClassification(event.target.value)}><option value="all">All candidates</option><option value="source-tagged">Source-tagged</option></select></label><label>Order by<select value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="trending">Trending</option><option value="volume">24h volume ↓</option><option value="liquidity">Liquidity ↓</option><option value="change">24h change ↓</option></select></label></div>
      <p className="ml-list-note">Source # stays fixed when you filter or sort; it is not the displayed row position. All volume and liquidity figures are for one pool. Missing values are N/A, never zero.</p>
      {fresh && board && (board.partial || board.metadataFailed > 0) && <div className="ml-notice">Partial source coverage. {board.metadataFailed > 0 ? `${board.metadataFailed} metadata request(s) were unavailable. ` : ""}Unclassified tokens remain candidates; absence of a tag is not evidence that a token is not a meme.</div>}
      {error && <div className="ml-notice ml-error" role="alert"><strong>Source unavailable</strong><p>{error}</p><small>{retrySeconds > 0 ? `Refresh unlocks in ${retrySeconds}s. ` : ""}No automatic retry. No cached ranking is presented as current.</small></div>}
      {loading ? <div className="ml-empty" role="status"><span className="ml-empty-mark" aria-hidden="true">⌁</span><h3>Reading the trending source</h3><p>Finding observed candidates and available category context.</p></div> : board && !fresh ? <div className="ml-empty"><span className="ml-empty-mark" aria-hidden="true">◷</span><h3>This snapshot has expired</h3><p>Rankings and token details are hidden after five minutes, or when the fetch timestamp cannot be trusted. Refresh to retrieve a current snapshot.</p></div> : fresh && rows.length === 0 ? <div className="ml-empty"><span className="ml-empty-mark" aria-hidden="true">⊙</span><h3>{classification === "source-tagged" && tagged === 0 ? "No source-tagged memes in this snapshot" : candidates.length ? "No candidates match these filters" : "No eligible candidates returned"}</h3><p>{classification === "source-tagged" && tagged === 0 ? "No matching provider meme categories were available in this bounded snapshot. Candidates are not silently substituted; you can choose All candidates to explore unclassified tokens." : candidates.length ? "Try a different search or include all candidates." : "The observed source page has no eligible tokens. This does not mean there are no meme tokens on Robinhood Chain."}</p>{candidates.length > 0 && <button className="ml-secondary" type="button" onClick={() => { setSearch(""); setClassification("all"); }}>{classification === "source-tagged" ? "View all candidates" : "Clear filters"}</button>}</div> : fresh && board ? <>
        <div className="ml-results-meta">{rows.length} {classification === "source-tagged" ? "source-tagged" : "candidate"} results shown · {sort === "trending" ? "source trending order" : "sorted within observed candidates"} · expand a token for evidence</div>
        <div className="ml-column-head" aria-hidden="true"><span>Source # / token</span><span>Price / USD</span><span>1h change</span><span>24h change</span><span>24h pool volume</span><span>Pool liquidity</span><span>Market cap / FDV</span><span /></div>
        <ul className="ml-list">{rows.map(({ token }) => <li key={token.address}><button type="button" className="ml-row" aria-expanded={expanded === token.address} aria-controls={`ml-detail-${token.address}`} onClick={() => setExpanded(expanded === token.address ? null : token.address)}>
          <span className="ml-identity"><span className="ml-rank">#{count(token.rank)}</span><TokenIcon token={token} /><span className="ml-token-text"><strong>{token.symbol || "Unknown"}</strong><small title={token.name}>{token.name || short(token.address)}</small><span className="ml-tags"><Badge token={token} />{token.stockPaired && <span className="ml-badge ml-stock">Stock-paired</span>}</span></span></span>
          <span className="ml-value ml-price"><span className="ml-mobile-label">Price / USD</span>{money(token.priceUsd, true)}</span>
          <span className="ml-value"><span className="ml-mobile-label">1h change</span><Change value={token.change1hPct} /></span>
          <span className="ml-value"><span className="ml-mobile-label">24h change</span><Change value={token.change24hPct} /></span>
          <span className="ml-value"><span className="ml-mobile-label">24h pool volume</span>{money(token.volume24hUsd)}</span>
          <span className="ml-value"><span className="ml-mobile-label">Pool liquidity</span>{money(token.liquidityUsd)}</span>
          <span className="ml-value ml-valuation"><span className="ml-mobile-label">Market cap</span>{money(token.marketCapUsd)}<small>FDV {money(token.fdvUsd)}</small></span>
          <span className="ml-expand" aria-hidden="true">{expanded === token.address ? "−" : "+"}</span>
        </button>{expanded === token.address && <Details token={token} board={board} />}</li>)}</ul>
      </> : !error && <div className="ml-empty"><h3>No snapshot available</h3><p>Refresh the source to begin. Nothing is inferred from missing data.</p></div>}
      {board && <div className="ml-source-footer"><strong>{board.source}</strong><span>{board.ranking}</span><span>{board.coverage}</span></div>}
    </section>

    <section className="ml-method" aria-labelledby="ml-method-title"><div><p className="ml-eyebrow">READ THE SCOPE, NOT JUST THE RANK</p><h2 id="ml-method-title">Attention is a starting point.<br /><span>Context is the next step.</span></h2></div><dl><Metric label="01 / Bounded discovery">GeckoTerminal’s Robinhood trending-pools first page, up to 20 pools. Token addresses are deduplicated; canonical stock tokens and known native, WETH and USDG assets are excluded. This is not a chain-wide top list.</Metric><Metric label="02 / Source tags, not certification">Category enrichment is limited to the first 12 candidates. Provider meme, inu, dog, cat and PolitiFi category matches receive a source-tagged badge. Other tokens remain candidates, not confirmed memes.</Metric><Metric label="03 / One pool, not the whole token">Default order follows source pool trending rank among observed candidates. Pool volume and liquidity are not aggregated across markets. Market cap can be unavailable; FDV is not a substitute.</Metric><Metric label="04 / Volatile and potentially illiquid">Trending tokens may fall in price. Low liquidity can amplify volatility and make exiting difficult. Source tags do not establish legitimacy or safety. This page provides research, not trading or financial advice.</Metric></dl></section>
    <footer className="ml-footer">No wallet connection. No transactions. Token images, when available, load from approved external image hosts. Source retrieval expires after five minutes; provider observation freshness is not established.</footer>
  </div>;
}
