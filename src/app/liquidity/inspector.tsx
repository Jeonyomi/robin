"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LpPositionSnapshot } from "@/lib/sources/uniswap-v3/position";

function short(address: string) { return `${address.slice(0, 8)}…${address.slice(-6)}`; }
function price(value: number) { return new Intl.NumberFormat("en", { maximumSignificantDigits: 8 }).format(value); }

/** A user-triggered PUBLIC NFT read. It is not wallet connection or ownership proof. */
export default function PositionInspector({ now }: { now: number }) {
  const [tokenId, setTokenId] = useState("");
  const [snapshot, setSnapshot] = useState<LpPositionSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  useEffect(() => () => pending.current?.abort(), []);
  function change(value: string) {
    requestId.current += 1; pending.current?.abort();
    setTokenId(value); setSnapshot(null); setError(""); setLoading(false);
  }
  async function inspect(event: FormEvent) {
    event.preventDefault();
    const submitted = tokenId.trim();
    if (!/^[1-9]\d{0,77}$/.test(submitted) || BigInt(submitted) >= BigInt(2) ** BigInt(256)) { setError("Enter a positive v3 NFT position ID within uint256 range."); return; }
    const id = ++requestId.current;
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    const timer = setTimeout(() => controller.abort(), 25_000);
    setSnapshot(null); setError(""); setLoading(true);
    try {
      const response = await fetch(`/api/v1/lp-position?tokenId=${encodeURIComponent(submitted)}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok || !body.data) throw new Error(body.error || "Onchain position is unavailable. No previous snapshot has been substituted.");
      const data = body.data as LpPositionSnapshot;
      if (data.chainId !== 4663 || data.protocol !== "uniswap-v3" || data.tokenId !== submitted || !Number.isFinite(Date.parse(data.observedAt))) throw new Error("Unexpected source response. Snapshot withheld.");
      if (id === requestId.current) setSnapshot(data);
    } catch (caught) {
      if (id === requestId.current) setError(controller.signal.aborted ? "Read timed out. Snapshot withheld; try again later." : caught instanceof Error ? caught.message : "Read unavailable. Snapshot withheld.");
    } finally { clearTimeout(timer); if (id === requestId.current) setLoading(false); }
  }
  const age = snapshot ? now - Date.parse(snapshot.observedAt) : 0;
  const stale = age > 120_000 || age < -30_000;
  const range = snapshot?.rangeState === "closed" ? "Closed · zero liquidity" : snapshot?.rangeState === "in-range" ? "In range at snapshot" : snapshot?.rangeState === "below-range" ? "Below range at snapshot" : "Above range at snapshot";
  return (
    <section className="lp-inspector" aria-labelledby="lp-inspector-title">
      <div className="lp-inspector-intro"><div><p className="section-kicker">PUBLIC ONCHAIN READ · UNISWAP V3 · CHAIN 4663</p><h2 id="lp-inspector-title">Check a real position</h2><p>Enter a public v3 NFT position ID. No wallet connection or signature. This does not establish that the position is yours.</p></div><span className="lp-tag">Read only · On demand</span></div>
      <form className="lp-inspector-form" onSubmit={inspect}><label className="lp-field"><span>Uniswap v3 position ID</span><input name="positionTokenId" inputMode="numeric" pattern="[1-9][0-9]*" maxLength={78} value={tokenId} onChange={(event) => change(event.target.value)} required placeholder="Enter NFT token ID" /></label><button className="lp-primary-button" type="submit" disabled={loading}>{loading ? "Checking onchain…" : "Read position"}</button></form>
      <p className="lp-input-hint">This public ID is sent to the app server and official RPC for this read only. No portfolio is saved or discovered. v4 positions and automated monitoring are not enabled.</p>
      {error && <p role="alert" className="lp-error">{error}</p>}
      {snapshot && <div className="lp-chain-result" aria-label="Verified-source position snapshot">
        <div className="lp-chain-result-head"><strong>Uniswap v3 · Position #{snapshot.tokenId}</strong><span className={`lp-tag ${stale || snapshot.rangeState !== "in-range" ? "lp-tag-warn" : ""}`}>{stale ? "Stale snapshot · refresh" : range}</span></div>
        <p className="lp-chain-time">Observed block <b>{snapshot.blockNumber}</b> · {new Date(snapshot.observedAt).toLocaleString()} · no auto-refresh</p>
        <div className="lp-chain-tokens"><a href={`https://robinhoodchain.blockscout.com/token/${snapshot.token0.address}`} target="_blank" rel="noreferrer">Base · token0 {short(snapshot.token0.address)} ↗</a><a href={`https://robinhoodchain.blockscout.com/token/${snapshot.token1.address}`} target="_blank" rel="noreferrer">Quote · token1 {short(snapshot.token1.address)} ↗</a></div>
        <dl className="lp-readouts lp-chain-readouts"><div><dt>Pool spot price · quote per base</dt><dd>{price(snapshot.priceToken1PerToken0)}</dd></div><div><dt>Position price range · quote per base</dt><dd>{price(snapshot.lowerToken1PerToken0)} <small>to</small> {price(snapshot.upperToken1PerToken0)}</dd></div><div><dt>Current tick / position ticks</dt><dd>{snapshot.tick} <small>/ {snapshot.tickLower} to {snapshot.tickUpper}</small></dd></div><div><dt>Pool fee tier · not APR</dt><dd>{price(snapshot.feeTier / 10_000)}%</dd></div><div><dt>Uncollected / lifetime fees</dt><dd className="lp-unavailable">Withheld · accounting not verified</dd></div><div><dt>APR / IL / Hold-relative PnL</dt><dd className="lp-unavailable">Withheld · history required</dd></div></dl>
        <details className="lp-details"><summary>Verify pool, owner and raw state</summary><p>Contract deployment provenance, factory linkage and token order are checked at one block. This is not a contract security audit or an executable price quote. Prices are approximate; raw state is below.</p><dl className="lp-raw-state"><div><dt>Pool</dt><dd><a href={`https://robinhoodchain.blockscout.com/address/${snapshot.pool}`} target="_blank" rel="noreferrer">{snapshot.pool} ↗</a></dd></div><div><dt>Public NFT owner · not verified as yours</dt><dd>{snapshot.owner}</dd></div><div><dt>Position manager</dt><dd>{snapshot.positionManager}</dd></div><div><dt>Factory</dt><dd>{snapshot.factory}</dd></div><div><dt>Raw liquidity · not token units or TVL</dt><dd>{snapshot.liquidityRaw}</dd></div><div><dt>sqrtPriceX96</dt><dd>{snapshot.sqrtPriceX96}</dd></div><div><dt>Token0 / token1 decimals</dt><dd>{snapshot.token0.decimals} / {snapshot.token1.decimals}</dd></div><div><dt>Block hash</dt><dd>{snapshot.blockHash}</dd></div></dl></details>
      </div>}
    </section>
  );
}
