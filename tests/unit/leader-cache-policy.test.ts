import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routes = [
  "src/app/api/v1/lp-leaders/route.ts",
  "src/app/api/v1/meme-leaders/route.ts",
];

describe("leader read-path caching", () => {
  it.each(routes)("allows CDN reuse for %s", (route) => {
    const routeSource = readFileSync(route, "utf8");
    expect(routeSource).toContain("s-maxage=");
    expect(routeSource).toContain("stale-while-revalidate=");
    expect(routeSource).toContain("s-maxage=240");
    expect(routeSource).not.toContain('const headers = { "Cache-Control": "no-store, max-age=0" }');
  });

  it("does not bypass browser caching for the remaining Meme Leaders client", () => {
    const clientSource = readFileSync("src/app/meme-leaders/explorer.tsx", "utf8");
    expect(clientSource).not.toMatch(/fetch\([^\n]+cache:\s*["']no-store["']/);
  });
});
