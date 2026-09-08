// @vitest-environment jsdom
import React from "react";
import Link from "next/link";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OverviewResearch } from "../../src/components/overview-research";

vi.stubGlobal("React", React);

function renderOverview() {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(React.createElement(OverviewResearch)),
    "text/html",
  );
}

describe("Overview research workspaces", () => {
  it("offers three bounded research destinations without live data or prefetch", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const document = renderOverview();
      const cards = Array.from(document.querySelectorAll("article"));
      expect(cards).toHaveLength(3);
      expect(cards.map((card) => card.querySelector("h3")?.textContent)).toEqual([
        "Meme / Stock Pairs", "LP Leaders", "Meme Leaders",
      ]);
      expect(cards.map((card) => card.querySelector("a")?.getAttribute("href"))).toEqual([
        "/liquidity#stock-pairs", "/liquidity#lp-leaders", "/meme-leaders",
      ]);
      for (const card of cards) {
        expect(card.querySelector("a")?.textContent?.trim()).toBeTruthy();
        expect(card.querySelector(".overview-research-coverage")?.textContent).toContain("Coverage:");
      }
      const pair = cards[0].textContent ?? "";
      expect(pair).toContain("v3/v4 pool state");
      expect(pair).toContain("related LP positions");
      expect(pair).toContain("up to 8 NFTs");
      expect(pair).toContain("empty sample does not prove a pool has no LP positions");
      const lp = cards[1].textContent ?? "";
      expect(lp).toContain("lifetime recorded WETH fee entitlement");
      expect(lp).toContain("bounded sample of observed positions");
      expect(lp).toContain("not a chain-wide leaderboard or realized profit");
      const meme = cards[2].textContent ?? "";
      expect(meme).toContain("provider trending order");
      expect(meme).toContain("first page, up to 20 pools");
      expect(meme).toContain("deduplicated by base-token contract");
      expect(meme).toContain("Source-tagged");
      expect(meme).toContain("not an authenticity or safety assurance");

      // Inspect the actual Next Link elements: prefetch is not an HTML attribute.
      const links: React.ReactElement<{ href: string; prefetch: boolean }>[] = [];
      function visit(node: React.ReactNode) {
        React.Children.forEach(node, (child) => {
          if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return;
          if (child.type === Link) links.push(child as React.ReactElement<{ href: string; prefetch: boolean }>);
          visit(child.props.children);
        });
      }
      visit(OverviewResearch());
      expect(links.map((link) => [link.props.href, link.props.prefetch])).toEqual([
        ["/liquidity#stock-pairs", false], ["/liquidity#lp-leaders", false], ["/meme-leaders", false],
      ]);
      expect(document.querySelectorAll("time, [role='status'], [aria-live], .metric-value")).toHaveLength(0);
      const text = document.body.textContent ?? "";
      expect(text.match(/\d+/g)).toEqual(["3", "4", "8", "20"]);
      expect(text).not.toMatch(/[$%]|\bAPR\b|\bAPY\b|updated at|as of|live now/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
  it("labels its capabilities as editorial guidance rather than a live snapshot", () => {
    const document = renderOverview();
    const heading = document.querySelector("h2");
    expect(heading?.textContent).toBe("Explore liquidity & meme activity");
    expect(document.querySelector("section")?.getAttribute("aria-labelledby")).toBe(heading?.id);
    expect(document.body.textContent).toContain("RESEARCH WORKSPACES");
    expect(document.body.textContent).toContain("Product capabilities, not a live market snapshot.");
    expect(document.body.textContent).toContain("Pair discovery → pool evidence → LP position review");
  });
});
