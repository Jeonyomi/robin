import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Liquidity primary workspace", () => {
  it("serves Meme & Stock Pairs directly without an LP Leaders or WETH-pairs page entry", () => {
    const page = read("src/app/liquidity/page.tsx");
    const layout = read("src/app/layout.tsx");
    const overview = read("src/components/overview-research.tsx");

    expect(page).toContain('import StockPairs from "./stock-pairs"');
    expect(page).toContain("<StockPairs />");
    expect(page).not.toContain("LiquidityTabs");
    expect(page).toContain('title: "Meme & Stock Pairs"');

    expect(layout).toContain('label: "Meme & Stock Pairs"');
    expect(layout).not.toContain('label: "LP Leaders"');
    expect(overview).not.toContain("LP Leaders");
    expect(overview).not.toContain("#lp-leaders");
  });
});
