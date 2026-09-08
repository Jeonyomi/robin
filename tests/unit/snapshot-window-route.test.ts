import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSnapshot } from "@/lib/snapshot";
import { GET as overview } from "@/app/api/v1/overview/route";
import { GET as capitalFlow } from "@/app/api/v1/capital-flow/route";
import { GET as stocks } from "@/app/api/v1/stock-tokens/route";
import { GET as opportunities } from "@/app/api/v1/opportunities/route";

vi.mock("@/lib/db", () => ({ hasDatabase: () => false, getDb: vi.fn(() => { throw new Error("No live database in tests"); }) }));
vi.mock("@/lib/snapshot", async (original) => ({ ...await original<typeof import("@/lib/snapshot")>(), loadSnapshot: vi.fn() }));
beforeEach(() => {
  vi.mocked(loadSnapshot).mockResolvedValue({ builtAt: "2026-09-08T09:00:00Z", overview: {}, stockTokens: { "24h": [] }, syncStates: [] });
});

describe("missing snapshot windows have an honest unavailable response", () => {
  it.each([["overview", overview], ["capital-flow", capitalFlow], ["stock-tokens", stocks], ["opportunities", opportunities]] as const)("%s does not claim no snapshot exists when just the requested window is absent", async (endpoint, handler) => {
    const response = await handler(new Request(`http://localhost/api/v1/${endpoint}?window=1h`));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.data).toBeNull();
    expect(body.meta).toMatchObject({ window: "1h", servedFrom: "snapshot", degraded: true });
    expect(body.error).toContain("requested observation window");
    expect(body.meta.uiOnly).toBeUndefined();
  });
});
