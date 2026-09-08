import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTokenTransfers } from "@/lib/sources/blockscout/transfers";
import { fetchSourceJson, SourceRequestError } from "@/lib/sources/source-request";
vi.mock("@/lib/sources/source-request", async original => ({ ...await original<typeof import("@/lib/sources/source-request")>(), fetchSourceJson: vi.fn() }));
vi.mock("@/lib/config", () => ({ getAPIs: () => ({ blockscout: { baseUrl: "https://blockscout.invalid/api/v2" } }) }));
const token = `0x${"1".repeat(40)}`;
const event = { block_number: "123", log_index: "0", transaction_hash: `0x${"a".repeat(64)}`,
  timestamp: "2026-01-01T00:00:00Z", from: { hash: token }, to: { hash: `0x${"0".repeat(40)}` },
  token: { address_hash: token, decimals: "18" }, total: { value: "0" } };
beforeEach(() => { vi.mocked(fetchSourceJson).mockReset(); });
describe("transfer evidence must fail closed", () => {
  it("does not convert a transfer 404 to empty success", async () => {
    vi.mocked(fetchSourceJson).mockImplementation(async (_source, _url, options) => {
      if (options?.allow404) return null;
      throw new SourceRequestError("http", 404);
    });
    await expect(fetchTokenTransfers(token)).rejects.toMatchObject({ code: "http", status: 404 });
  });
  it.each([
    { from: null }, { to: { hash: "bad" } }, { from: { hash: "" } },
    { token: { address_hash: `0x${"2".repeat(40)}` } }, { token: { address_hash: "bad" } },
    { transaction_hash: "0x123" }, { block_number: -1 }, { log_index: -1 },
    { block_number: "" }, { log_index: "1e2" }, { block_number: 9007199254740992 },
    { timestamp: "invalid" }, { timestamp: "2026-02-30T00:00:00Z" }, { timestamp: "2999-01-01T00:00:00Z" },
  ])("rejects the entire page containing invalid identity/time %j", async bad => {
    vi.mocked(fetchSourceJson).mockResolvedValue({ items: [event, { ...event, ...bad }] });
    await expect(fetchTokenTransfers(token)).rejects.toMatchObject({ code: "schema" });
  });
  it("accepts genuine empty pages and valid zero-address/zero-index events", async () => {
    vi.mocked(fetchSourceJson).mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ items: [event] });
    await expect(fetchTokenTransfers(token)).resolves.toEqual({ items: [], nextCursor: null });
    await expect(fetchTokenTransfers(token)).resolves.toMatchObject({ items: [{ blockNumber: 123, logIndex: 0, txHash: event.transaction_hash, timestamp: new Date(event.timestamp) }] });
  });
  it("rejects malformed cursors and request addresses before transport", async () => {
    await expect(fetchTokenTransfers("bad")).rejects.toMatchObject({ code: "schema" });
    await expect(fetchTokenTransfers(token, { index: -1, blockNumber: 123 })).rejects.toMatchObject({ code: "schema" });
    expect(fetchSourceJson).not.toHaveBeenCalled();
  });
  it("rejects invalid provider cursor identity", async () => {
    vi.mocked(fetchSourceJson).mockResolvedValue({ items: [], next_page_params: { index: "", block_number: -1 } });
    await expect(fetchTokenTransfers(token)).rejects.toMatchObject({ code: "schema" });
  });
});
