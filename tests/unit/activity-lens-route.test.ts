// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasDatabase } from "@/lib/db";
import { getOverviewData, type OverviewData } from "@/lib/queries";
import { loadSnapshot } from "@/lib/snapshot";
import { GET } from "@/app/api/v1/opportunities/route";
vi.mock("@/lib/db", () => ({ hasDatabase: vi.fn(), getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/queries", () => ({ getOverviewData: vi.fn() }));
vi.mock("@/lib/snapshot", async (original) => ({ ...await original<typeof import("@/lib/snapshot")>(), loadSnapshot: vi.fn() }));
const now = "2026-09-08T12:00:00Z";
function observation(exposure: boolean | undefined, status = "success") {
  return { window: "24h", activity: { transferEvents: 25 }, coverage: { completedCycles: 8, trackedTokens: 10, tokensWithStoredTransfers: 10, observedTokensInWindow: 10, observationExposureVerified: exposure, status, lastIndexedAt: now }, topTokens: [{ address: "0x1", transferCount: 25, activityIndex: 100 }], lastUpdatedAt: now } as unknown as OverviewData;
}
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date(now)); });
afterEach(() => vi.useRealTimers());
describe.each([true, false])("Activity Lens route (database=%s)", (database) => {
  async function respond(exposure: boolean | undefined, status = "success") {
    const data = observation(exposure, status);
    vi.mocked(hasDatabase).mockReturnValue(database);
    vi.mocked(getOverviewData).mockResolvedValue(data);
    vi.mocked(loadSnapshot).mockResolvedValue({ builtAt: now, overview: { "24h": data }, stockTokens: {}, syncStates: [] });
    const response = await GET(new Request("http://localhost/api/v1/opportunities?window=24h"));
    expect(response.status).toBe(200);
    return response.json();
  }
  it("passes explicit verified exposure into the gate", async () => {
    const body = await respond(true);
    expect(body.meta.status).toBe("active-limited");
    expect(body.data).toHaveLength(1);
  });
  it.each([undefined, false])("withholds historical snapshots/page-bounded data without exposure evidence (%s)", async (exposure) => {
    const body = await respond(exposure);
    expect(body.meta.status).toBe("withheld");
    expect(body.data).toEqual([]);
    expect(body.meta.release.reasons).toContain("Comparable observation exposure is unverified for this window");
  });
  it.each(["error", "degraded", "running", "not-started"])("cannot release %s observations despite verified exposure", async (status) => {
    const body = await respond(true, status);
    expect(body.meta.status).toBe("withheld");
    expect(body.data).toEqual([]);
    expect(body.meta.release.reasons).toContain("Transfer sync is not successful");
  });
});
