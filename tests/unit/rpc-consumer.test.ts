import React from "react";
import { readFileSync } from "node:fs";
import LegalPage from "../../src/app/legal/page";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { CurrentRotation } from "../../src/components/observation-status";
import { GET } from "../../src/app/api/v1/source-health/route";
vi.stubGlobal("React", React);
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/api-helpers", () => ({ tryDatabase: async (fn: () => Promise<unknown>) => ({ ok: true, data: await fn() }) }));
vi.mock("@/lib/queries", () => ({ getSyncStatesData: async () => [{ source: "rpc", jobName: "token-transfers", status: "error", lastSuccessAt: null, lastStartedAt: "2026-01-01T12:00:00Z", lastError: "secret provider error" }] }));
vi.mock("@/lib/snapshot", () => ({ loadSnapshot: async () => null }));
vi.mock("@/lib/sources/uniswap-v3/snapshot-store", () => ({ readStoredLpSnapshot: async () => null }));
it("keeps bounded RPC disclosure in legal copy while omitting the coverage banner from user pages", () => {
 const html = renderToStaticMarkup(React.createElement(LegalPage));
 expect(html).toContain("RPC transfer collection");
 expect(html).toContain("not continuous indexing");
 for (const page of ["src/app/page.tsx", "src/app/capital-flow/page.tsx"]) {
  const source = readFileSync(page, "utf8");
  expect(source).not.toContain("CurrentRotation");
  expect(source).not.toContain("scope-banner");
 }
});
it("displays bounded RPC scope instead of rotation completeness", () => {
 const html = renderToStaticMarkup(React.createElement(CurrentRotation, { coverage: { collectionMode: "bounded-recent-rpc", skippedBlocks: 500 } as never }));
 expect(html).toContain("48-block");
 expect(html).toContain("mixed historical Blockscout/RPC");
 expect(html).not.toContain("prior completed rotations");
});
it("reports actual RPC failure and attempt independently from Blockscout stats", async () => {
 const body = await (await GET()).json();
 expect(body.data.sources).toContainEqual(expect.objectContaining({ name: "RPC Token Transfers", status: "degraded", lastAttemptAt: "2026-01-01T12:00:00Z", lastSuccessAt: null }));
 expect(JSON.stringify(body)).not.toContain("secret provider error");
 expect(body.data.sources).toContainEqual(expect.objectContaining({ name: "Blockscout Chain Stats", status: "unknown" }));
});
