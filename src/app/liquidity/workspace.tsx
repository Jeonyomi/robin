"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PositionInputSchema, analyzePosition, type PositionInput } from "@/lib/domain/lp";
import { useLpWorkspace } from "@/lib/hooks/use-lp-workspace";
import PositionInspector from "./inspector";
import { inputAge, MAX_WORKSPACE_BYTES, parseWorkspace, serializeWorkspace } from "@/lib/lp-workspace";

type Draft = Record<"label" | "baseSymbol" | "quoteSymbol" | "entryPrice" | "currentPrice" | "lowerPrice" | "upperPrice" | "capitalQuote" | "feesQuote" | "costsQuote" | "elapsedDays" | "observedAt", string>;
const emptyDraft: Draft = { label: "", baseSymbol: "", quoteSymbol: "", entryPrice: "", currentPrice: "", lowerPrice: "", upperPrice: "", capitalQuote: "", feesQuote: "", costsQuote: "", elapsedDays: "", observedAt: "" };
const numericFields = ["entryPrice", "currentPrice", "lowerPrice", "upperPrice", "capitalQuote", "feesQuote", "costsQuote", "elapsedDays"] as const;
function num(value: number | null, signed = false): string {
  if (value == null) return "Not available";
  return new Intl.NumberFormat("en", { maximumFractionDigits: 6, notation: value !== 0 && Math.abs(value) < 0.000001 ? "scientific" : "standard", signDisplay: signed ? "exceptZero" : "auto" }).format(value);
}
function localTime(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function message(error: unknown) { return error instanceof Error ? error.message : "Operation failed. No changes saved."; }

function PositionCard({ position, now, onEdit, onRemove }: { position: PositionInput; now: number; onEdit: () => void; onRemove: () => void }) {
  const result = analyzePosition(position);
  const recent = inputAge(position, now) === "recent";
  const outside = result.rangeState !== "in-range";
  const edge = !outside && result.nearestEdgePct <= 5;
  const status = outside ? result.rangeState === "below-range" ? "Below range" : "Above range" : edge ? "Near range edge" : "Inside range";
  const scenarios = [position.lowerPrice, position.entryPrice, position.upperPrice].map((price) => ({ price, ...analyzePosition({ ...position, currentPrice: price }) }));
  return (
    <article className="lp-position" aria-label={`${position.label} scenario`}>
      <div className="lp-position-head">
        <div><p className="section-kicker">{position.baseSymbol} / {position.quoteSymbol} · MANUAL SCENARIO</p><h2>{position.label}</h2></div>
        <span className={`lp-tag ${!recent || outside || edge ? "lp-tag-warn" : ""}`}>{!recent ? "Stale input · review" : status}</span>
      </div>
      <div className="lp-price-line"><strong>{num(position.currentPrice)}</strong><span>{position.quoteSymbol} per {position.baseSymbol}<small>User price · {new Date(position.observedAt).toLocaleString()}</small></span></div>
      <div className="lp-range" aria-label={`Input-price range position: ${status}`}><span style={{ width: `${result.rangeProgressPct}%` }} /><i style={{ left: `${Math.min(99, Math.max(1, result.rangeProgressPct))}%` }} /></div>
      <div className="lp-range-labels"><span>Lower <b>{num(position.lowerPrice)}</b></span><span>Entry <b>{num(position.entryPrice)}</b></span><span>Upper <b>{num(position.upperPrice)}</b></span></div>
      <p className="lp-range-note">At the entered price: {status.toLowerCase()}. {outside ? result.rangeState === "below-range" ? `Modeled inventory is entirely ${position.baseSymbol}.` : `Modeled inventory is entirely ${position.quoteSymbol}.` : `Nearest edge is ${num(result.nearestEdgePct)}% of the entered price away.`} {!recent && "No current range alert can be inferred from this old input."}</p>
      <dl className="lp-readouts">
        <div><dt>Modeled LP value</dt><dd>{num(result.lpValueQuote)} <small>{position.quoteSymbol}</small></dd></div>
        <div><dt>Same-entry Hold value</dt><dd>{num(result.holdValueQuote)} <small>{position.quoteSymbol}</small></dd></div>
        <div><dt>Entered cumulative fees</dt><dd>{num(position.feesQuote)} {position.feesQuote != null && <small>{position.quoteSymbol}</small>}</dd></div>
        <div><dt>Historical fee APR · simple</dt><dd>{num(result.feesAprPct)}{result.feesAprPct != null && "%"}</dd></div>
        <div><dt>Modeled divergence / IL · no fees</dt><dd className={result.divergenceQuote < 0 ? "negative" : ""}>{num(result.divergenceQuote, true)} <small>{position.quoteSymbol} ({num(result.divergencePct, true)}%)</small></dd></div>
        <div><dt>Net vs Hold · fees less costs</dt><dd>{num(result.netVsHoldQuote, true)} {result.netVsHoldQuote != null && <small>{position.quoteSymbol}</small>}</dd></div>
        <div><dt>Net PnL vs entry capital</dt><dd>{num(result.netPnlQuote, true)} {result.netPnlQuote != null && <small>{position.quoteSymbol}</small>}</dd></div>
        <div><dt>DEX volume / active liquidity share</dt><dd className="lp-unavailable">Not connected</dd></div>
      </dl>
      {result.narrowRange && <p className="lp-warning">Narrow range: a small move can leave only one asset. A high annualized fee number does not offset this risk by itself.</p>}
      <details className="lp-details"><summary>Inspect range scenarios & calculation basis</summary>
        <p>Hypothetical prices, not a market forecast. Same starting quantities, fixed liquidity and unchanged range. Values are in {position.quoteSymbol}; no USD peg is assumed.</p>
        <div className="lp-table-wrap"><table><caption>Boundary scenarios before fees and costs</caption><thead><tr><th>Price</th><th>LP value</th><th>Hold value</th><th>Difference</th></tr></thead><tbody>{scenarios.map((row) => <tr key={row.price}><td>{num(row.price)}</td><td>{num(row.lpValueQuote)}</td><td>{num(row.holdValueQuote)}</td><td>{num(row.divergenceQuote, true)}</td></tr>)}</tbody></table></div>
        <p>Entry inventory: {num(result.entryBase)} {position.baseSymbol} + {num(result.entryQuote)} {position.quoteSymbol}. Modeled inventory at input price: {num(result.currentBase)} {position.baseSymbol} + {num(result.currentQuote)} {position.quoteSymbol}.</p>
        <p>Fee APR = entered fees ÷ entry capital × 365 ÷ elapsed days. Requires at least one day; no compounding or future-return estimate. Net metrics require explicit fees and costs. Blank does not mean zero.</p>
      </details>
      <div className="lp-card-actions"><button onClick={onEdit}>Edit inputs</button><button onClick={onRemove} aria-label={`Remove ${position.label}`}>Remove</button></div>
    </article>
  );
}

export default function LpWorkspace() {
  const store = useLpWorkspace();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<PositionInput | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const formRef = useRef<HTMLFormElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  function update(key: keyof Draft, value: string) { setDraft((current) => ({ ...current, [key]: value })); }
  function clear() { setDraft(emptyDraft); setEditing(null); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      if (!draft.observedAt || !Number.isFinite(new Date(draft.observedAt).getTime())) throw new Error("Enter the actual observation time of your price input.");
      const raw: Record<string, unknown> = { ...draft, id: editing?.id ?? crypto.randomUUID(), observedAt: new Date(draft.observedAt).toISOString() };
      for (const key of numericFields) raw[key] = draft[key].trim() === "" ? null : Number(draft[key]);
      const parsed = PositionInputSchema.safeParse(raw);
      if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).slice(0, 3).join(" · "));
      if (editing && JSON.stringify(store.positions.find((item) => item.id === editing.id)) !== JSON.stringify(editing)) throw new Error("This scenario changed or was removed in another tab. Cancel editing and reopen the latest version.");
      const next = editing ? store.positions.map((item) => item.id === editing.id ? parsed.data : item) : [...store.positions, parsed.data];
      await store.save(next); clear(); setNow(Date.now()); setNotice("Scenario saved in this browser only. No onchain position was opened.");
    } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  }
  function edit(position: PositionInput) {
    const next = { ...emptyDraft };
    for (const key of Object.keys(next) as (keyof Draft)[]) next[key] = position[key] == null ? "" : String(position[key]);
    next.observedAt = localTime(position.observedAt);
    setDraft(next); setEditing(position); setError(""); setNotice(""); formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function remove(position: PositionInput) {
    if (!window.confirm(`Remove the local scenario “${position.label}”? This does not affect any onchain position.`)) return;
    setBusy(true);
    try { await store.save(store.positions.filter((item) => item.id !== position.id)); if (editing?.id === position.id) clear(); setNotice("Local scenario removed."); setError(""); } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    setError(""); setNotice(""); setBusy(true);
    try {
      if (file.size > MAX_WORKSPACE_BYTES) throw new Error("Import exceeds 256 KB.");
      const imported = parseWorkspace(await file.text());
      if (!window.confirm(`Replace this browser's workspace with ${imported.positions.length} imported scenarios? Export first to keep a backup. Imported numbers remain unverified user inputs.`)) return;
      await store.save(imported.positions); clear(); setNotice("Workspace restored. Imported prices and amounts are unverified manual inputs, not chain evidence.");
    } catch (caught) { setError(message(caught)); }
    finally { setBusy(false); if (importRef.current) importRef.current.value = ""; }
  }
  const stale = store.positions.filter((position) => inputAge(position, now) !== "recent").length;
  const review = store.positions.filter((position) => { const result = analyzePosition(position); return inputAge(position, now) !== "recent" || result.rangeState !== "in-range" || result.nearestEdgePct <= 5; }).length;
  function numberField(key: keyof Draft, label: string, required = true) {
    return <label className="lp-field" key={key}><span>{label}{!required && <small> optional</small>}</span><input name={key} type="number" step="any" required={required} min="0" value={draft[key]} onChange={(event) => update(key, event.target.value)} /></label>;
  }
  return (
    <div className="page-shell lp-shell">
      <header className="section-hero lp-hero"><div><p className="eyebrow">PERSONAL RESEARCH · NO EXECUTION</p><h1>LP Workspace</h1><p>Keep conviction positions in view. Understand the range before chasing the yield.</p></div><span className="lp-tag">Read-only LP research</span></header>
      <PositionInspector now={now} />
      <section className="lp-boundary" aria-label="Data boundary"><strong>Scenario mode, not a connected portfolio.</strong><p>The scenarios below use only your manual inputs and remain separate from the onchain inspector above. No wallet balances, accrued fees or DEX volume are imported into them. Transfer counts are never used as trading volume.</p></section>
      <div className="lp-overview"><div><span>Saved scenarios</span><strong>{store.ready ? store.positions.length : "…"}<small>/ 50</small></strong></div><div><span>Input review needed</span><strong>{review}<small>{stale > 0 ? `${stale} stale` : "price-based checks"}</small></strong></div><div><span>Automatic monitoring</span><strong className="lp-word-stat">Not connected</strong><small>No Telegram alerts or background checks</small></div></div>
      <div className="lp-workspace-toolbar"><p>Saved locally on this browser and origin. Not encrypted or synced. Export before switching devices.</p><div><button disabled={busy || !store.ready || (!store.positions.length && !store.error)} onClick={() => { try { download(store.error ? store.revision ?? "" : serializeWorkspace(store.positions), "robin-lp-workspace.json"); } catch (caught) { setError(message(caught)); } }}>Export backup</button><button disabled={busy || !store.ready || !!store.error} onClick={() => importRef.current?.click()}>Import backup</button><input ref={importRef} className="lp-file" type="file" accept=".json,application/json" aria-label="Import workspace JSON" onChange={(event) => void importFile(event.target.files?.[0])} /></div></div>
      {(error || store.error) && <div className="lp-error" role="alert">{error || store.error}{store.error && <button disabled={busy} onClick={async () => { if (window.confirm("Reset unreadable local workspace? Export the raw backup first. This cannot be undone.")) { setBusy(true); try { await store.reset(); clear(); setError(""); } catch (caught) { setError(message(caught)); } finally { setBusy(false); } } }}>Reset local storage</button>}</div>}
      {notice && <p className="lp-notice" role="status">{notice}</p>}
      <div className="lp-workspace-grid" inert={busy} aria-busy={busy}>
        <section className="lp-position-list" aria-label="Saved LP scenarios">
          {store.positions.length ? store.positions.map((position) => <PositionCard key={position.id} position={position} now={now} onEdit={() => edit(position)} onRemove={() => remove(position)} />) : <div className="lp-empty"><span className="lp-empty-mark" aria-hidden="true">↔</span><p className="section-kicker">START WITH YOUR OWN INPUTS</p><h2>Your ranges. Your assumptions.</h2><p>Add a fixed-range scenario to compare LP inventory with holding the same starting tokens. Nothing is prefilled with sample returns or invented positions.</p><ul><li>Track asymmetric ranges and single-asset exposure</li><li>Separate divergence loss, fees and operating costs</li><li>See what is missing before relying on an APR</li></ul></div>}
        </section>
        <aside className="lp-editor"><form ref={formRef} onSubmit={submit}>
          <p className="section-kicker">{editing ? "EDIT SCENARIO" : "NEW SCENARIO"}</p><h2>{editing ? "Update your inputs" : "Set a range"}</h2><p className="lp-form-intro">Uniswap v3-style model. One deposit, unchanged liquidity and range. No token identity or ownership is verified.</p>
          <label className="lp-field"><span>Scenario name</span><input name="label" maxLength={60} required value={draft.label} onChange={(event) => update("label", event.target.value)} autoComplete="off" /></label>
          <div className="lp-field-grid"><label className="lp-field"><span>Base token label</span><input name="baseSymbol" maxLength={16} required value={draft.baseSymbol} onChange={(event) => update("baseSymbol", event.target.value)} /></label><label className="lp-field"><span>Quote token label</span><input name="quoteSymbol" maxLength={16} required value={draft.quoteSymbol} onChange={(event) => update("quoteSymbol", event.target.value)} /></label></div>
          <p className="lp-input-hint">Every price is quote tokens per one base token. Token labels are not contract addresses.</p>
          <div className="lp-field-grid">{numberField("entryPrice", "Entry price")}{numberField("currentPrice", "Observed price")}{numberField("lowerPrice", "Lower bound")}{numberField("upperPrice", "Upper bound")}</div>
          {numberField("capitalQuote", "Entry capital · quote units")}
          <label className="lp-field"><span>Price observed at · your local time</span><input name="observedAt" type="datetime-local" required value={draft.observedAt} onChange={(event) => update("observedAt", event.target.value)} /></label><button type="button" className="lp-inline-button" onClick={() => update("observedAt", localTime(new Date().toISOString()))}>I observed this price just now</button>
          <details className="lp-fee-inputs"><summary>Fees & costs · optional</summary><p>Enter cumulative fees and costs in quote units over the same period. Include claimed and unclaimed fees without double counting. Unknown values stay blank.</p>{numberField("feesQuote", "Cumulative fees · quote units", false)}{numberField("costsQuote", "Total costs · quote units", false)}{numberField("elapsedDays", "Elapsed days since entry", false)}</details>
          <button className="lp-primary-button" type="submit" disabled={!store.ready || !!store.error || (!editing && store.positions.length >= 50)}>{editing ? "Save changes" : "Add scenario"}</button>{editing && <button type="button" className="lp-cancel" onClick={clear}>Cancel editing</button>}
          <p className="lp-input-hint">No wallet connection, signing, approval, deposit or trade.</p>
        </form></aside>
      </div>
      <section className="lp-method"><div><p className="section-kicker">BEFORE PERFORMANCE BECOMES VERIFIED</p><h2>Evidence first. Automation second.</h2><p>The inspector checks a public v3 position at one block. Verified fee accounting, complete cash flows and reliable swap history are still required before a connected performance dashboard can report returns.</p></div><dl><div><dt>Range settings</dt><dd>Wider is not risk-free. A lower-heavy range increases base-token exposure on a decline. No fixed width or allocation is recommended here.</dd></div><div><dt>Range checks</dt><dd>Based only on your entered price. A 5% edge-distance flag is a review aid, not a volatility-calibrated signal. Inputs older than two hours are marked stale.</dd></div><div><dt>Accounting boundary</dt><dd>Tick rounding, token transfer taxes, rebases, reinvested fees, liquidity changes, v4 hooks and intra-period quote-token price changes are not modeled. USD profit is not asserted.</dd></div><div><dt>Telegram alerts</dt><dd>Off. Requires a verified live price feed, recipient authorization and deduplication. Keeping this page open does not start price monitoring.</dd></div></dl></section>
      <footer className="method-footer">All scenario performance is calculated from your inputs. The onchain inspector reports public state separately, not returns. No investment recommendation, predicted APR or onchain accounting claim. <a href="https://uniswap.org/whitepaper-v3.pdf" target="_blank" rel="noreferrer">Uniswap v3 model reference ↗</a></footer>
    </div>
  );
}
