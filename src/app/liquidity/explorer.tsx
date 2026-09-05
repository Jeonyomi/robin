"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isFreshLeaderboard, LP_LEADER_FRESH_MS, LpLeaderboardSchema, rankLpLeaders, type LpLeaderboard, type LpLeader } from "@/lib/lp-leaders";
import "./explorer.css";

const EXPLORER = "https://robinhoodchain.blockscout.com";
const number = (value: number) => new Intl.NumberFormat("en", { maximumSignificantDigits: 7, notation: value !== 0 && (Math.abs(value) >= 1e9 || Math.abs(value) < 1e-7) ? "scientific" : "standard" }).format(value);
const stateLabel = (state: LpLeader["rangeState"]) => ({ "in-range": "In range", "below-range": "Below range", "above-range": "Above range", closed: "Closed" })[state];
// Decimal placement is string-based: never round raw uint256 fees through Number.
function nativeAmount(raw: string, decimals: number) {
  const padded = raw.padStart(decimals + 1, "0");
  if (!decimals) return padded;
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return `${padded.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}
function LeaderDetails({ row, board }: { row: LpLeader; board: LpLeaderboard }) {
  const span = Math.log(row.upperWethPerBase) - Math.log(row.lowerWethPerBase);
  const marker = Math.max(0, Math.min(100, span > 0 ? (Math.log(row.priceWethPerBase) - Math.log(row.lowerWethPerBase)) / span * 100 : 50));
  return <div className="leaders-details" id={`leader-${row.tokenId}`} data-testid="leader-details">
    <div className="leaders-detail-grid">
      <section aria-label="Observed price range"><h3>Range structure · {row.structure}</h3><p>WETH per 1 {row.baseSymbol} · approximate pool-tick bounds</p>
        <div className="leaders-range" role="img" aria-label={`${stateLabel(row.rangeState)}; lower ${row.lowerWethPerBase}, spot ${row.priceWethPerBase}, upper ${row.upperWethPerBase} WETH per base. Logarithmic scale; marker clamped to bounds.`}><span style={{ left: `${marker}%` }} /></div>
        <dl className="leaders-range-values"><div><dt>Lower</dt><dd>{String(row.lowerWethPerBase)}</dd></div><div><dt>Spot</dt><dd>{String(row.priceWethPerBase)}</dd></div><div><dt>Upper</dt><dd>{String(row.upperWethPerBase)}</dd></div></dl>
        <p>Logarithmic marker · width {number(row.rangeWidthPct)}% · nearest edge {number(row.nearestEdgePct)}%. Values reflect this observation, not an executable quote.</p>
        {(row.structure === "concentrated" || row.rangeState !== "in-range") && <p className="leaders-risk">{row.structure === "concentrated" ? "Concentrated liquidity is sensitive to small price moves. " : ""}{row.rangeState !== "in-range" ? "Out-of-range or closed liquidity does not earn active swap fees. " : ""}Range shape does not establish intent, skill, safety, or future earnings.</p>}
      </section>
      <section aria-label="Native token accounting"><h3>Lifetime recorded fees · native units</h3><dl className="leaders-accounting">
        {[{ token: row.token0, fees: row.fees0, amount: row.amount0 }, { token: row.token1, fees: row.fees1, amount: row.amount1 }].map(({ token, fees, amount }) => <div key={token.address}><dt>{token.symbol} <small>({token.decimals} decimals)</small></dt><dd>{nativeAmount(fees, token.decimals)} <small>recorded fees</small></dd><dd>{String(amount)} <small>observed LP inventory</small></dd><dd className="leaders-raw">Raw recorded units: {fees}</dd></div>)}
      </dl><p>Current LP inventory excludes outstanding claims. Liquidity withdrawn as principal is excluded from fee income. Lifetime fees span previous owners too. NPM accounting can differ from actual received cash by raw-unit rounding.</p>{row.spotFeeValueWeth !== undefined && <p className="leaders-risk">Illustrative pool-spot value of all token fees: {number(row.spotFeeValueWeth)} WETH. This is not used for ranking and may be distorted by illiquidity or manipulation.</p>}</section>
    </div>
    <dl className="leaders-events"><div><dt>Minted (UTC)</dt><dd>{row.mintedAt}</dd></div><div><dt>Liquidity increases / decreases</dt><dd>{row.increases} / {row.decreases}</dd></div><div><dt>Collections</dt><dd>{row.collections}</dd></div><div><dt>Ownership transfers</dt><dd>{row.transfers ?? "Not reconstructed"}</dd></div></dl>
    <div className="leaders-links"><a href={`${EXPLORER}/token/${board.positionManager}/instance/${row.tokenId}`} target="_blank" rel="noopener noreferrer">NFT #{row.tokenId} ↗</a><a href={`${EXPLORER}/address/${row.pool}`} target="_blank" rel="noopener noreferrer">Pool contract ↗</a><a href={`${EXPLORER}/address/${board.positionManager}`} target="_blank" rel="noopener noreferrer">Position manager ↗</a><a href={`${EXPLORER}/token/${row.token0.address}`} target="_blank" rel="noopener noreferrer">Token0 contract ↗</a><a href={`${EXPLORER}/token/${row.token1.address}`} target="_blank" rel="noopener noreferrer">Token1 contract ↗</a></div>
    <p className="leaders-owner">Public owner at observation, not asserted to be yours: <a href={`${EXPLORER}/address/${row.owner}`} target="_blank" rel="noopener noreferrer">{row.owner}</a></p>
  </div>;
}

export default function LpExplorer() {
  const [board, setBoard] = useState<LpLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("fees");
  const [selected, setSelected] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true); setError(""); setBoard(null); setSelected(null);
    const timeout = setTimeout(() => controller.abort(), 65_000);
    try {
      const response = await fetch("/api/v1/lp-leaders", { cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("data" in body) || !("error" in body) || body.error !== null) throw new Error("Leaderboard unavailable. No previous ranking is displayed. Try Refresh.");
      const parsed = LpLeaderboardSchema.safeParse(body.data);
      if (!parsed.success) throw new Error("Invalid leaderboard response. Ranking withheld.");
      const data = parsed.data;
      const weth = data.weth.toLowerCase();
      if (new Set(data.rows.map((row) => row.tokenId)).size !== data.rows.length || data.rows.some((row) => row.lowerWethPerBase >= row.upperWethPerBase || ![row.token0.address.toLowerCase(), row.token1.address.toLowerCase()].includes(weth) || row.baseAddress.toLowerCase() === weth)) throw new Error("Invalid leaderboard response. Ranking withheld.");
      if (!isFreshLeaderboard(data)) throw new Error("Observation is stale. Ranking withheld; Refresh to request a new observation.");
      if (mounted.current && pending.current === controller) setBoard(data);
    } catch (caught) {
      if (mounted.current && pending.current === controller) { setBoard(null); setError(controller.signal.aborted ? "Read timed out. Ranking unavailable; try Refresh." : caught instanceof Error ? caught.message : "Leaderboard unavailable. Ranking withheld."); }
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) { pending.current = null; if (mounted.current) setLoading(false); }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    // Deferred startup avoids a duplicate request during React's development effect replay.
    const startup = setTimeout(() => { void refresh(); }, 0);
    return () => { mounted.current = false; clearTimeout(startup); pending.current?.abort(); pending.current = null; };
  }, [refresh]);
  useEffect(() => {
    if (!board) return;
    const expire = () => { if (!isFreshLeaderboard(board)) { setBoard(null); setSelected(null); setError("Observation is stale. Ranking withheld; Refresh to request a new observation."); } };
    const timer = setTimeout(expire, Math.max(0, Date.parse(board.observedAt) + LP_LEADER_FRESH_MS + 1 - Date.now()));
    const interval = setInterval(expire, 1000);
    return () => { clearTimeout(timer); clearInterval(interval); };
  }, [board]);
  const visibleBoard = board && isFreshLeaderboard(board) ? board : null;
  const rows = visibleBoard ? rankLpLeaders(visibleBoard.rows).filter((row) => filter === "all" || (filter === "out" ? row.rangeState === "below-range" || row.rangeState === "above-range" : row.rangeState === filter)) : [];
  if (sort === "capital") rows.sort((a, b) => b.capitalWeth - a.capitalWeth);
  return <div className="leaders-shell">
    <header className="leaders-hero"><div><p className="leaders-kicker">ONCHAIN RESEARCH / UNISWAP V3 / CHAIN 4663</p><h1>LP Leaders<span>.</span></h1><p>Discover high-fee LP NFTs. Inspect the range, inventory, and lifetime fee record behind each position.</p></div><span className="leaders-badge">Read only · WETH pairs</span></header>
    <div className="leaders-basis"><strong>Fees, not net profit.</strong> Ranks use lifetime fees recorded in WETH only. Other token fees appear separately, without price conversion in the ranking. This is not net profit, APR, or a whole-chain top list.</div>
    <section className="leaders-panel" aria-label="LP NFT leaderboard" aria-busy={loading}>
      <div className="leaders-toolbar"><div><h2>Observed leaders</h2><p>Rank within the sampled WETH-pair positions</p></div><button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Reading chain…" : "Refresh"}</button></div>
      {visibleBoard && <><div className="leaders-coverage" data-testid="leader-coverage"><div><strong>{visibleBoard.sampled}<small> / {visibleBoard.totalNfts}</small></strong><span>Observed sample / enumerable NFTs</span></div><div><strong>{visibleBoard.eligible}</strong><span>Eligible</span></div><div><strong>{visibleBoard.excluded}</strong><span>Excluded</span></div><div><strong>{visibleBoard.unsupported}</strong><span>Unsupported</span></div></div><p className="leaders-observation">Stratified enumeration · not newest-only or chain-wide top ranking. Block {visibleBoard.blockNumber} · <time dateTime={visibleBoard.observedAt}>{visibleBoard.observedAt}</time> · automatic expiry, no background RPC polling.</p></>}
      <div className="leaders-controls"><label>Range state<select value={filter} onChange={(event) => { setFilter(event.target.value); setSelected(null); }}><option value="all">All states</option><option value="in-range">In range</option><option value="out">Out of range</option><option value="closed">Closed</option></select></label><label>Sort by<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="fees">WETH fees ↓</option><option value="capital">Inventory ↓</option></select></label><span>{visibleBoard ? `${rows.length} positions shown` : "Ranking withheld until a fresh observation"}</span></div>
      {loading && <div role="status" className="leaders-empty"><span className="leaders-loading-dot" />Reading public NFT records…<p>No wallet, signature, or token ID required.</p></div>}
      {error && <div role="alert" className="leaders-error">{error}</div>}
      {visibleBoard && !rows.length && <div role="status" className="leaders-empty">{visibleBoard.rows.length ? "No positions match this range filter." : "No eligible WETH-pair positions in this observation."}<p>{visibleBoard.rows.length ? "Choose All states to see the observed sample." : "An empty sample does not mean there are no LP positions on the chain."}</p></div>}
      {!!rows.length && visibleBoard && <><div className="leaders-column-head" aria-hidden="true"><span>Rank / NFT position</span><span>Recorded WETH fees</span><span>Current LP inventory · WETH</span><span>Range structure / state</span></div><ol className="leaders-list">{rows.map((row, index) => <li key={row.tokenId} data-testid="leader-row"><button className="leaders-row" aria-expanded={selected === row.tokenId} aria-controls={`leader-${row.tokenId}`} aria-label={`Inspect NFT #${row.tokenId}`} onClick={() => setSelected(selected === row.tokenId ? null : row.tokenId)}><span className="leaders-identity"><span className="leaders-rank">{index + 1}</span><span><strong>#{row.tokenId}</strong><small>{row.baseSymbol}/WETH · {number(row.feeTier / 10_000)}% fee tier</small></span></span><span className="leaders-fees"><small className="leaders-mobile-label">Recorded WETH fees</small><strong>{number(row.feeIncomeWeth)}</strong></span><span className="leaders-capital"><small className="leaders-mobile-label">LP inventory · WETH</small>{number(row.capitalWeth)}</span><span className="leaders-range-state"><span>{row.structure}</span><small className={row.rangeState === "in-range" ? "leaders-in" : "leaders-out"}>{stateLabel(row.rangeState)} at observation <b aria-hidden="true">{selected === row.tokenId ? "−" : "+"}</b></small></span></button>{selected === row.tokenId && <LeaderDetails row={row} board={visibleBoard} />}</li>)}</ol></>}
    </section>
    <section className="leaders-method" aria-labelledby="leaders-method-title"><div><p className="leaders-kicker">READ THE RECORD, NOT A PROMISE</p><h2 id="leaders-method-title">What the numbers mean.</h2></div><dl><div><dt>A stratified sample</dt><dd>Enumeration indices are sampled across the NFT collection; only supported WETH pairs with eligible records appear. Counts distinguish sampled, eligible, excluded, and unsupported positions. This is not a chain-wide top-earner ranking.</dd></div><div><dt>Lifetime fees ≠ owner profit</dt><dd>Fee records belong to the NFT lifetime, including previous owners. Withdrawn principal is excluded. Only the native WETH fee leg determines rank; other token fees are shown in their own units. NPM accounting is not exact cash received because of raw-unit rounding. Realized net PnL, APR/APY and performance versus holding are not established.</dd></div><div><dt>Structure is not a strategy recommendation</dt><dd>Full-range, wide, and concentrated describe range shape only, not trader intent or advice. Out-of-range liquidity can stop earning fees. Concentration adds price sensitivity; no future income is promised.</dd></div><div><dt>Spot-price risk</dt><dd>Current inventory and the optional all-token fee estimate use pool spot prices and can be distorted by illiquidity or manipulation. Neither is used for fee rank. No USD value or executable conversion is implied. Older or larger positions can dominate lifetime fees; burned and unsampled NFTs are not represented. Legacy local storage remains untouched.</dd></div></dl></section>
  </div>;
}
