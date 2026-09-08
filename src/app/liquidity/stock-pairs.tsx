"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PairDiscovery, PairPositions, PoolInspection, StockPair } from "@/lib/meme-stock-types";

const API = "/api/v1/meme-stock-pairs";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const SOURCE_MAX_AGE = 5 * 60_000;
const STATE_MAX_AGE = 2 * 60_000;
const format = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "N/A" : new Intl.NumberFormat("en", { maximumSignificantDigits: 7, notation: value !== 0 && Math.abs(value) < 0.000001 ? "scientific" : "standard" }).format(value);
const usd = (value: number | null) => value == null || !Number.isFinite(value) ? "N/A" : new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const short = (value: string) => value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
const protocolName = (protocol: StockPair["protocol"]) => protocol === "uniswap-v3" ? "Uniswap v3" : protocol === "uniswap-v4" ? "Uniswap v4" : "Source only";
const samePool = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isFresh = (timestamp: string, maxAge: number, now: number) => Number.isFinite(Date.parse(timestamp)) && now >= Date.parse(timestamp) && now - Date.parse(timestamp) < maxAge;

type ReadGate = { allowed: () => boolean; cooldown: (until: number) => void };

/** User-triggered reads only; the sole automatic read is lightweight discovery. */
function useRead<T>(gate: ReadGate) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, []);
  const read = useCallback(async (query = "", accepts?: (value: T) => boolean) => {
    if (pending.current || !gate.allowed()) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true); setError(""); setData(null);
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(`${API}${query}`, { cache: "no-store", signal: controller.signal });
      if (response.status === 429 || response.status === 503) {
        const retry = response.headers.get("Retry-After");
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : null;
        const deadline = seconds !== null ? Date.now() + seconds * 1000 : retry ? Date.parse(retry) : NaN;
        gate.cooldown(Number.isFinite(deadline) && deadline > Date.now() ? deadline : Date.now() + (response.status === 429 ? 60_000 : 15_000));
      }
      const body = await response.json() as { data: T | null; error: string | null };
      if (!response.ok || body.error !== null || body.data == null) throw new Error(typeof body.error === "string" ? body.error : "This read is unavailable. Please try again.");
      if (accepts && !accepts(body.data)) throw new Error("The response did not match the selected pool. Results withheld.");
      if (pending.current === controller && !controller.signal.aborted) setData(body.data);
    } catch (caught) {
      if (pending.current === controller) setError(controller.signal.aborted ? "The read timed out. No result is displayed; please retry." : caught instanceof Error ? caught.message : "Unable to read this source.");
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) { pending.current = null; setLoading(false); }
    }
  }, [gate]);
  return { data, loading, error, read };
}

function External({ href, children, title }: { href: string; children: ReactNode; title?: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" title={title}>{children}<span aria-hidden="true"> ↗</span></a>;
}
function Freshness({ at, now, maxAge, source = false }: { at: string; now: number; maxAge: number; source?: boolean }) {
  const valid = Number.isFinite(Date.parse(at));
  return <span className={`sp-freshness ${isFresh(at, maxAge, now) ? "" : "sp-stale"}`}><span aria-hidden="true">● </span>{!valid ? "Timestamp unavailable" : isFresh(at, maxAge, now) ? source ? "Within source fetch window" : "Within observation window" : "Stale · refresh required"}{valid && <> · <time dateTime={at}>{at}</time></>}</span>;
}
function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`sp-notice ${error ? "sp-error" : ""}`} role={error ? "alert" : "status"}>{children}</div>;
}
function Metric({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return <div className="sp-metric"><dt>{label}</dt><dd>{value}</dd>{note && <small>{note}</small>}</div>;
}

function Positions({ result, inspection, pair, now, manual = false }: { result: PairPositions; inspection: PoolInspection; pair: StockPair; now: number; manual?: boolean }) {
  const label = (address: string) => [pair.base, pair.quote].find((token) => token.address.toLowerCase() === address.toLowerCase())?.symbol || short(address);
  return <div className="sp-position-results">
    <div className="sp-result-summary"><strong>{manual ? "NFT inspection" : "Bounded related sample"}</strong><span>{result.inspected} inspected · {result.positions.length} matched · {result.failed} failed</span></div>
    <p className="sp-caption">{result.coverage}</p>
    <p className="sp-caption">Exact pool checked: <code>{result.poolId}</code></p>
    <Freshness at={result.observedAt} now={now} maxAge={STATE_MAX_AGE} />
    {!result.positions.length && <Notice>No matching LP positions returned. This does not establish that the pool has no LPs.</Notice>}
    {result.positions.map((position) => <article className="sp-position" key={`${position.manager}:${position.tokenId}`}>
      <div className="sp-position-heading"><External href={`${EXPLORER}/token/${position.manager}/instance/${position.tokenId}`}>NFT #{position.tokenId}</External><span className={`sp-badge ${position.rangeState === "in-range" ? "sp-badge-stock" : "sp-badge-candidate"}`}>{({ "in-range": "In range", "below-range": "Out of range · below", "above-range": "Out of range · above", closed: "Closed" })[position.rangeState]}</span></div>
      <dl className="sp-position-amounts"><Metric label={`${label(inspection.token0.address)} · token0`} value={format(position.amount0)} note="Observed native-token inventory" /><Metric label={`${label(inspection.token1.address)} · token1`} value={format(position.amount1)} note="Observed native-token inventory" /></dl>
      <dl className="sp-range-values"><Metric label="Lower" value={format(position.lowerToken1PerToken0)} /><Metric label="Observed spot" value={format(position.priceToken1PerToken0)} /><Metric label="Upper" value={format(position.upperToken1PerToken0)} /></dl>
      <p className="sp-caption">Price bounds: token1 per token0. Ticks {position.tickLower} → {position.tickUpper}; observed tick {position.tick}. Raw liquidity: <code>{position.liquidityRaw}</code>.</p>
      <p className="sp-caption">Block {position.blockNumber} · <time dateTime={position.observedAt}>{position.observedAt}</time></p>
      <p className="sp-caption">Public owner, not asserted to be you: <External href={`${EXPLORER}/address/${position.owner}`}>{short(position.owner)}</External></p>
    </article>)}
    <p className="sp-caption">Sampled scope, not a complete holder list or ranking. Native amounts are position inventory estimates at the observed state, not fee income, returns, or an executable withdrawal quote.</p>
  </div>;
}

function PairDetails({ pair, gate, retrySeconds, now }: { pair: StockPair; gate: ReadGate; retrySeconds: number; now: number }) {
  const pool = useRead<PoolInspection>(gate);
  const sample = useRead<PairPositions>(gate);
  const manual = useRead<PairPositions>(gate);
  const [tokenId, setTokenId] = useState("");
  const [inputError, setInputError] = useState("");
  const [submittedId, setSubmittedId] = useState("");
  const query = `?pool=${encodeURIComponent(pair.id)}`;
  const inspection = pool.data && samePool(pool.data.poolId, pair.id) ? pool.data : null;
  const inspectionFresh = !!inspection && isFresh(inspection.observedAt, STATE_MAX_AGE, now);
  const supported = pair.protocol !== "unsupported";
  const busy = pool.loading || sample.loading || manual.loading;
  const blocked = retrySeconds > 0 || busy;
  const counterpart = pair.stockSide === "base" ? pair.quote : pair.base;
  const positionsMatch = (value: PairPositions) => samePool(value.poolId, pair.id) && value.positions.every((position) => samePool(position.poolId, pair.id) && position.protocol === pair.protocol);
  return <div className="sp-details">
    <section className="sp-panel sp-reported" aria-labelledby="sp-pair-title">
      <div className="sp-section-heading"><div><p className="sp-eyebrow">01 / SOURCE-REPORTED SNAPSHOT</p><h2 id="sp-pair-title">{pair.base.symbol} <span className="sp-muted">/</span> {pair.quote.symbol}</h2></div><External href={pair.sourceUrl}>Dexscreener</External></div>
      <div className="sp-badges"><span className="sp-badge sp-badge-stock">Stock registry matched · {pair.stock.symbol}</span><span className="sp-badge sp-badge-candidate">Candidate meme / non-stock · {counterpart.symbol}</span><span className="sp-badge">{protocolName(pair.protocol)}</span></div>
      <p className="sp-caption">The stock token matches the canonical registry by address. The other token is a non-stock candidate, not a verified meme brand. Symbols alone do not establish identity.</p>
      <Freshness at={pair.retrievedAt} maxAge={SOURCE_MAX_AGE} now={now} source />
      <dl className="sp-metrics"><Metric label="Reported liquidity" value={usd(pair.liquidityUsd)} note="Third-party USD estimate" /><Metric label="24h swap volume" value={usd(pair.volume24hUsd)} note="Source-reported · USD" /><Metric label="24h buys" value={format(pair.buys24h)} note={`Source base: ${pair.base.symbol}`} /><Metric label="24h sells" value={format(pair.sells24h)} note={`Source base: ${pair.base.symbol}`} /></dl>
      <dl className="sp-balances"><Metric label={`${pair.base.symbol} · source base balance`} value={format(pair.baseReserve)} note="Reported native-token units" /><Metric label={`${pair.quote.symbol} · source quote balance`} value={format(pair.quoteReserve)} note="Reported native-token units" /></dl>
      <p className="sp-caption">Source price: {pair.priceNative ?? "N/A"} {pair.quote.symbol} per {pair.base.symbol}. Fetch time is not block freshness. These estimates are not independently verified by the pool read below. Missing values are N/A, never assumed zero.</p>
      <div className="sp-addresses">{[pair.base, pair.quote].map((token, index) => <div key={token.address}><span>{index === 0 ? "Base" : "Quote"} · {token.symbol} <small>{token.name}</small></span><External href={`${EXPLORER}/token/${token.address}`}>{token.address}</External></div>)}<div><span>{pair.protocol === "uniswap-v4" ? "v4 pool ID · not a contract address" : "Pool identifier"}</span><External href={pair.protocol === "uniswap-v3" ? `${EXPLORER}/address/${pair.id}` : pair.sourceUrl}>{pair.id}</External></div></div>
    </section>

    <section className="sp-panel" aria-labelledby="sp-verify-title" aria-busy={pool.loading}>
      <div className="sp-section-heading"><div><p className="sp-eyebrow">02 / ONCHAIN INSPECTION</p><h2 id="sp-verify-title">Verify the pool, on demand.</h2></div><span className="sp-step-icon" aria-hidden="true">⌁</span></div>
      <p className="sp-description">Read a single pool through RPC. Inspect its tokens, tick, active liquidity and observed block separately from the reported market snapshot.</p>
      <button className="sp-primary" type="button" disabled={blocked || !supported} onClick={() => void pool.read(query, (value) => samePool(value.poolId, pair.id) && value.protocol === pair.protocol)}>{pool.loading ? "Reading pool state…" : retrySeconds > 0 ? `Retry in ${retrySeconds}s` : inspection ? "Refresh pool state ↗" : "Verify pool state ↗"}</button>
      {!supported && <Notice>This source pool is not supported by the onchain inspector. Source estimates remain available; no RPC request will be made.</Notice>}
      {pool.error && <Notice error>{pool.error}</Notice>}
      {inspection && <div className="sp-chain-result"><div className="sp-result-summary"><strong>Verified onchain observation</strong><span>Chain {inspection.chainId} · block {inspection.blockNumber}</span></div><Freshness at={inspection.observedAt} now={now} maxAge={STATE_MAX_AGE} />
        <dl className="sp-chain-metrics"><Metric label="Current tick" value={format(inspection.tick)} /><Metric label="Pool fee tier" value={`${format(inspection.feeTier)} pips`} note="Not a yield or return" /><Metric label="Token1 per token0" value={format(inspection.priceToken1PerToken0)} /></dl>
        <div className="sp-addresses"><div><span>Token0 · {inspection.token0.decimals} decimals</span><External href={`${EXPLORER}/token/${inspection.token0.address}`}>{inspection.token0.address}</External></div><div><span>Token1 · {inspection.token1.decimals} decimals</span><External href={`${EXPLORER}/token/${inspection.token1.address}`}>{inspection.token1.address}</External></div><div><span>Raw active liquidity · not a token balance</span><code>{inspection.liquidityRaw}</code></div><div><span>sqrtPriceX96</span><code>{inspection.sqrtPriceX96}</code></div><div><span>Observed block hash</span><External href={`${EXPLORER}/block/${inspection.blockNumber}`}>{inspection.blockHash}</External></div><div><span>Manager</span><External href={`${EXPLORER}/address/${inspection.manager}`}>{inspection.manager}</External></div>{inspection.stateView && <div><span>StateView</span><External href={`${EXPLORER}/address/${inspection.stateView}`}>{inspection.stateView}</External></div>}{inspection.factory && <div><span>Factory</span><External href={`${EXPLORER}/address/${inspection.factory}`}>{inspection.factory}</External></div>}{inspection.hooks && <div><span>Hooks · not a safety endorsement</span><External href={`${EXPLORER}/address/${inspection.hooks}`}>{inspection.hooks}</External></div>}</div>
        {inspection.warnings.map((warning, index) => <Notice key={index}>{warning}</Notice>)}
        <p className="sp-caption">Verification applies only to this pool-state observation. It does not verify 24h trading metrics, token legitimacy, safety, or future earnings.</p>
      </div>}
    </section>

    <section className="sp-panel" aria-labelledby="sp-positions-title" aria-busy={sample.loading || manual.loading}>
      <div className="sp-section-heading"><div><p className="sp-eyebrow">03 / LP POSITION RESEARCH</p><h2 id="sp-positions-title">Look inside the liquidity.</h2></div><span className="sp-badge">Read-only NFT inspection</span></div>
      <p className="sp-description">Request a bounded sample checked against this exact pool, or inspect one known position NFT. Nothing is scanned until you ask.</p>
      {!inspectionFresh && <p className="sp-caption">{inspection ? "Refresh the expired pool observation to request positions." : "Verify this pool first to identify token0 and token1 before reading positions."}</p>}
      <button className="sp-secondary" type="button" disabled={blocked || !inspectionFresh} onClick={() => void sample.read(`${query}&positions=1`, positionsMatch)}>{sample.loading ? "Checking bounded sample…" : sample.data ? "Refresh related LP sample" : "Load related LP sample"}</button>
      {sample.error && <Notice error>{sample.error}</Notice>}
      {sample.data && inspection && <Positions result={sample.data} inspection={inspection} pair={pair} now={now} />}
      <form className="sp-nft-form" onSubmit={(event) => {
        event.preventDefault();
        if (!/^[1-9]\d*$/.test(tokenId)) { setInputError("Enter a positive decimal NFT token ID, without spaces, signs or leading zeros."); return; }
        if (blocked || !inspectionFresh) return;
        setInputError(""); setSubmittedId(tokenId);
        void manual.read(`${query}&tokenId=${encodeURIComponent(tokenId)}`, (value) => positionsMatch(value) && value.positions.every((position) => position.tokenId === tokenId));
      }}><label htmlFor="sp-token-id">Have an NFT ID?<span>Positive decimal token ID · public position data only</span></label><div className="sp-input-action"><input id="sp-token-id" inputMode="numeric" autoComplete="off" placeholder="Enter token ID" value={tokenId} onChange={(event) => { setTokenId(event.target.value); setInputError(""); }} aria-invalid={!!inputError} aria-describedby={inputError ? "sp-token-error" : undefined} /><button className="sp-secondary" type="submit" disabled={blocked || !inspectionFresh || !tokenId}>{manual.loading ? "Inspecting…" : "Inspect NFT ↗"}</button></div>{inputError && <p className="sp-field-error" id="sp-token-error" role="alert">{inputError}</p>}</form>
      {manual.error && <Notice error>NFT #{submittedId}: {manual.error}</Notice>}
      {manual.data && inspection && <><p className="sp-caption">Requested NFT #{submittedId}</p><Positions result={manual.data} inspection={inspection} pair={pair} now={now} manual /></>}
    </section>
  </div>;
}

export default function StockPairs() {
  const [now, setNow] = useState(0);
  const [retryUntil, setRetryUntil] = useState(0);
  const deadline = useRef(0);
  const [gate] = useState<ReadGate>(() => ({ allowed: () => Date.now() >= deadline.current, cooldown: (until) => { deadline.current = Math.max(deadline.current, until); setRetryUntil(deadline.current); } }));
  const discovery = useRead<PairDiscovery>(gate);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stock, setStock] = useState("all");
  const [protocol, setProtocol] = useState("all");
  const [sort, setSort] = useState("liquidity");
  const readDiscovery = discovery.read;
  useEffect(() => {
    const startup = setTimeout(() => { setNow(Date.now()); void readDiscovery("", (value) => Array.isArray(value.pairs)); }, 0);
    // Local display clock only: no background API or RPC polling.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(startup); clearInterval(timer); };
  }, [readDiscovery]);
  const board = discovery.data;
  const retrySeconds = Math.max(0, Math.ceil((retryUntil - now) / 1000));
  const selected = board?.pairs.find((pair) => pair.id === selectedId) ?? null;
  const searchTerm = search.toLowerCase().trim();
  const rows = (board?.pairs ?? []).filter((pair) => (stock === "all" || pair.stock.symbol === stock) && (protocol === "all" || pair.protocol === protocol) && (!searchTerm || [pair.base.symbol, pair.base.name, pair.base.address, pair.quote.symbol, pair.quote.name, pair.quote.address, pair.id].some((value) => value.toLowerCase().includes(searchTerm)))).sort((a, b) => {
    const av = sort === "volume" ? a.volume24hUsd : a.liquidityUsd;
    const bv = sort === "volume" ? b.volume24hUsd : b.liquidityUsd;
    return av === null ? bv === null ? a.id.localeCompare(b.id) : 1 : bv === null ? -1 : bv - av || a.id.localeCompare(b.id);
  });
  return <div className="sp-shell">
    <header className="sp-hero"><div><p className="sp-eyebrow">ROBINHOOD CHAIN / PAIR DISCOVERY</p><h1>Meme <span>/</span> Stock Pairs<span>.</span></h1><p>Find where stock tokens meet the rest of the market.<br />Start with reported activity. Go onchain only when you choose.</p></div><div className="sp-hero-stamp"><span aria-hidden="true">↗</span><strong>Discover. Verify. Inspect.</strong><small>No wallet connection. No transactions.</small></div></header>
    <div className="sp-principles"><span><b>01</b> Source discovery</span><i aria-hidden="true">→</i><span><b>02</b> On-demand pool read</span><i aria-hidden="true">→</i><span><b>03</b> Bounded NFT inspection</span></div>
    <div className="sp-disclaimer"><strong>A research surface, not a meme certification.</strong> Discovery covers a fixed stock basket matched to canonical token addresses. Non-stock counterparts are candidates, not verified meme brands. Source estimates and onchain observations are intentionally separate.</div>
    {retrySeconds > 0 && <Notice>Source or RPC service is cooling down. Retry in {retrySeconds}s. No automatic retry will run.</Notice>}
    <div className={`sp-workspace ${selected ? "sp-has-selection" : ""}`}>
      <section className="sp-panel sp-discovery" aria-labelledby="sp-discovery-title" aria-busy={discovery.loading}>
        <div className="sp-section-heading"><div><p className="sp-eyebrow">THE DISCOVERY LIST</p><h2 id="sp-discovery-title">Stock × non-stock</h2></div><button className="sp-secondary" type="button" disabled={discovery.loading || retrySeconds > 0} onClick={() => void discovery.read("", (value) => Array.isArray(value.pairs))}>{discovery.loading ? "Fetching…" : retrySeconds > 0 ? `Retry in ${retrySeconds}s` : "Refresh"}</button></div>
        {board && <><p className="sp-caption">{board.source} · {board.pairs.length} discovered pairs · {board.stockSymbols.length} stock symbols in scope</p><Freshness at={board.retrievedAt} now={now} maxAge={SOURCE_MAX_AGE} source /><p className="sp-caption">{board.coverage}</p>{board.partial && <p className="sp-caption">Bounded discovery scope · not a whole-chain or exhaustive market list.</p>}{board.failedStocks.length > 0 && <Notice>Some provider lookups were unavailable: {board.failedStocks.join(", ")}. Missing pairs are not evidence of no market.</Notice>}</>}
        <div className="sp-filters"><label className="sp-search">Search pairs<input type="search" placeholder="Symbol, token or pool address" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label>Stock<select value={stock} onChange={(event) => setStock(event.target.value)}><option value="all">All stocks</option>{board?.stockSymbols.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}</select></label><label>Protocol<select value={protocol} onChange={(event) => setProtocol(event.target.value)}><option value="all">All protocols</option><option value="uniswap-v3">Uniswap v3</option><option value="uniswap-v4">Uniswap v4</option><option value="unsupported">Source only</option></select></label><label>Order by<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="liquidity">Reported liquidity</option><option value="volume">24h volume</option></select></label></div>
        {discovery.error && <Notice error>{discovery.error}</Notice>}
        {discovery.loading ? <div className="sp-empty" role="status"><span className="sp-loading" aria-hidden="true" /><h3>Finding stock-paired markets</h3><p>Reading the discovery source. No pool RPC scans are running.</p></div> : board && rows.length === 0 ? <div className="sp-empty"><span aria-hidden="true">⊙</span><h3>{board.pairs.length ? "No pairs match these filters" : "No eligible pairs returned"}</h3><p>{board.pairs.length ? "Try another symbol or broaden the stock and protocol filters." : "This source snapshot found no stock / non-stock matches in the covered basket."}</p>{board.pairs.length > 0 && <button className="sp-secondary" type="button" onClick={() => { setSearch(""); setStock("all"); setProtocol("all"); }}>Clear filters</button>}</div> : <><p className="sp-list-meta">{rows.length} shown · third-party estimates · select to inspect</p><ul className="sp-pair-list">{rows.map((pair) => <li key={pair.id}><button className="sp-pair-card" type="button" aria-pressed={selectedId === pair.id} onClick={() => setSelectedId(pair.id)}><div className="sp-pair-card-top"><span className="sp-token-monogram" aria-hidden="true">{pair.stock.symbol.slice(0, 2)}</span><span className="sp-pair-identity"><strong>{pair.base.symbol} <em>/</em> {pair.quote.symbol}</strong><small>{protocolName(pair.protocol)} · {pair.dex}</small></span><span className="sp-card-arrow" aria-hidden="true">↗</span></div><div className="sp-card-tags"><span>Stock registry matched · {pair.stock.symbol}</span><span>Candidate meme / non-stock</span></div><div className="sp-card-metrics"><span><small>Reported liquidity</small><strong>{usd(pair.liquidityUsd)}</strong></span><span><small>24h swap volume</small><strong>{usd(pair.volume24hUsd)}</strong></span></div><div className="sp-card-foot"><code>{short(pair.id)}</code><span className={isFresh(pair.retrievedAt, SOURCE_MAX_AGE, now) ? "" : "sp-stale"}>{isFresh(pair.retrievedAt, SOURCE_MAX_AGE, now) ? "Source fetched < 5m" : "Stale source fetch"}</span></div></button></li>)}</ul></>}
        {board && <p className="sp-caption sp-registry-note">Registry fetched: <time dateTime={board.registryRetrievedAt}>{board.registryRetrievedAt}</time>. Refresh is manual; no background polling.</p>}
      </section>
      {selected ? <div><div className="sp-selection-bar"><span>SELECTED PAIR <strong>{selected.base.symbol} / {selected.quote.symbol}</strong></span><button type="button" onClick={() => setSelectedId(null)}>Close details ×</button></div><PairDetails key={selected.id} pair={selected} gate={gate} retrySeconds={retrySeconds} now={now} /></div> : <aside className="sp-start"><div className="sp-orbit" aria-hidden="true"><span>↗</span></div><p className="sp-eyebrow">FOLLOW THE EVIDENCE</p><h2>One pair.<br />Three layers of context.</h2><p>Select a market to explore reported activity, verify its pool state, and inspect related LP NFTs.</p><ol><li><b>01</b><span><strong>Market snapshot</strong>Liquidity, swaps and token balances from the source.</span></li><li><b>02</b><span><strong>Pool state</strong>A deliberate RPC read, tied to an observed block.</span></li><li><b>03</b><span><strong>Position details</strong>Sampled ranges and native inventory, not promised returns.</span></li></ol><small>All reads are public. Nothing connects to or changes your wallet.</small></aside>}
    </div>
    <footer className="sp-footer"><strong>Know what each number represents.</strong><span>Source fetch window: 5 minutes. Onchain observation window: 2 minutes. Expired values remain labeled stale until you refresh. No APR, performance, or fee-yield claims.</span></footer>
  </div>;
}
