"use client";

import { useEffect, useRef, useState } from "react";
import LpExplorer from "./explorer";
import StockPairs from "./stock-pairs";
import "./stock-pairs.css";

const tabs = [{ id: "pairs", label: "Meme / Stock Pairs", hash: "stock-pairs" }, { id: "leaders", label: "LP Leaders", hash: "lp-leaders" }] as const;
type Tab = (typeof tabs)[number]["id"];

export default function LiquidityTabs() {
  // Resolve the share-link hash before mounting either data-fetching workspace.
  const [active, setActive] = useState<Tab | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    const syncHash = () => setActive(window.location.hash === "#lp-leaders" ? "leaders" : "pairs");
    syncHash();
    window.addEventListener("hashchange", syncHash);
    window.addEventListener("popstate", syncHash);
    return () => { window.removeEventListener("hashchange", syncHash); window.removeEventListener("popstate", syncHash); };
  }, []);
  const selectTab = (tab: (typeof tabs)[number]) => {
    setActive(tab.id);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${tab.hash}`);
  };
  return <>
    <div className="liquidity-tabs-wrap"><div className="liquidity-tabs" role="tablist" aria-label="Liquidity research">
      {tabs.map((tab, index) => <button key={tab.id} ref={(node) => { buttons.current[index] = node; }} type="button" role="tab" id={`liquidity-tab-${tab.id}`} aria-controls={`liquidity-panel-${tab.id}`} aria-selected={active === tab.id} tabIndex={active === tab.id || (active === null && index === 0) ? 0 : -1} onClick={() => selectTab(tab)} onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        selectTab(tabs[next]); buttons.current[next]?.focus();
      }}>{tab.label}{tab.id === "pairs" && <span className="liquidity-tab-tag">Discover</span>}</button>)}
    </div><span className="liquidity-tabs-note">PUBLIC DATA · READ ONLY</span></div>
    {/* Only the visible workspace mounts: hidden tabs never start API reads. */}
    {tabs.map((tab) => <div key={tab.id} role="tabpanel" id={`liquidity-panel-${tab.id}`} aria-labelledby={`liquidity-tab-${tab.id}`} hidden={active !== tab.id} tabIndex={0}>
      {active === tab.id && (tab.id === "leaders" ? <LpExplorer /> : <StockPairs />)}
    </div>)}
  </>;
}
