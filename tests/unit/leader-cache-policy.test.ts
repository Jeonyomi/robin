import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("leader read-path caching", () => {
  it("bounds LP CDN reuse by remaining source freshness without stale serving", () => {
    const routeSource = readFileSync("src/app/api/v1/lp-leaders/route.ts", "utf8");
    expect(routeSource).toContain("s-maxage=");
    expect(routeSource).toContain("remainingFreshSeconds");
    expect(routeSource).not.toContain("stale-while-revalidate=");
  });

  it("allows bounded CDN reuse for Meme Leaders", () => {
    const routeSource = readFileSync("src/app/api/v1/meme-leaders/route.ts", "utf8");
    expect(routeSource).toContain("s-maxage=240");
    expect(routeSource).toContain("stale-while-revalidate=");
  });

  it("does not bypass browser caching for the remaining Meme Leaders client", () => {
    const clientSource = readFileSync("src/app/meme-leaders/explorer.tsx", "utf8");
    expect(clientSource).not.toMatch(/fetch\([^\n]+cache:\s*["']no-store["']/);
  });
});
