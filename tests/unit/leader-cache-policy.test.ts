import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cases = [
  { route: "src/app/api/v1/lp-leaders/route.ts", client: "src/app/liquidity/explorer.tsx" },
  { route: "src/app/api/v1/meme-leaders/route.ts", client: "src/app/meme-leaders/explorer.tsx" },
];

describe("leader read-path caching", () => {
  it.each(cases)("allows CDN reuse for $route", ({ route, client }) => {
    const routeSource = readFileSync(route, "utf8");
    const clientSource = readFileSync(client, "utf8");
    expect(routeSource).toContain("s-maxage=");
    expect(routeSource).toContain("stale-while-revalidate=");
    expect(routeSource).toContain("s-maxage=240");
    expect(routeSource).not.toContain('const headers = { "Cache-Control": "no-store, max-age=0" }');
    expect(clientSource).not.toMatch(/fetch\([^\n]+cache:\s*["']no-store["']/);
  });
});
