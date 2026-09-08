// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MemeLeadersData, MemeLeader } from "@/lib/meme-leaders";
import Explorer from "@/app/meme-leaders/explorer";

// Entirely synthetic UI fixture; fetch is mocked, no provider requests.
const NOW = Date.parse("2026-09-08T09:00:00Z");
const NativeNumberFormat = Intl.NumberFormat;
const row: MemeLeader = {
  address: `0x${"11".repeat(20)}`, symbol: "TEST", name: "Synthetic fixture",
  rank: 1, providerPoolRank: 1, classification: "candidate", categories: [], metadataStatus: "not-requested",
  imageUrl: null, priceUsd: 1.25, change1hPct: null, change24hPct: 2,
  volume24hUsd: 12345, liquidityUsd: 1000, marketCapUsd: null, fdvUsd: 5000,
  buys24h: 5, sells24h: 2, poolId: `0x${"22".repeat(20)}`, poolName: "TEST / QUOTE",
  dex: "Test DEX", quoteSymbol: "QUOTE", stockPaired: false, poolCreatedAt: null,
  sourceUrl: "https://example.invalid/pool", tokenSourceUrl: "https://example.invalid/token", holders: null, holdersUpdatedAt: null,
};
const board: MemeLeadersData = { tokens: [row], retrievedAt: new Date(NOW).toISOString(), registryRetrievedAt: new Date(NOW).toISOString(), source: "Synthetic test", ranking: "Synthetic", coverage: "Synthetic", poolsObserved: 1, tokensObserved: 1, metadataRequested: 0, metadataFailed: 0, partial: true };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW); vi.stubGlobal("React", React);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: board, error: null }))));
});
afterEach(() => { cleanup(); Intl.NumberFormat = NativeNumberFormat; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each([null, 0, 0.00000001, 0.000001, 1.23456789, 123456789])("preserves price precision and missing values for %s", async (value) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { ...board, tokens: [{ ...row, priceUsd: value }] }, error: null }))));
  const view = render(React.createElement(Explorer));
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  const expected = value === null ? "N/A" : new NativeNumberFormat("en-US", {
    style: "currency", currency: "USD", maximumSignificantDigits: 6,
    notation: value !== 0 && Math.abs(value) < 0.000001 ? "scientific" : "standard",
  }).format(value);
  expect(view.container.querySelector(".ml-top-price strong")?.textContent).toBe(expected);
});

it("reuses number formatters on the display-clock tick without changing data or refreshing", async () => {
  render(React.createElement(Explorer));
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect((screen.getByRole("combobox", { name: "Classification" }) as HTMLSelectElement).value).toBe("all");
  expect(screen.getAllByText("$1.25").length).toBeGreaterThan(0);
  expect(screen.getAllByText("N/A").length).toBeGreaterThan(0);
  let formats = 0;
  Intl.NumberFormat = new Proxy(NativeNumberFormat, { construct(target, args) { formats++; return Reflect.construct(target, args); } });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(formats).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText("$1.25").length).toBeGreaterThan(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
  expect(screen.queryAllByText("$1.25")).toHaveLength(0);
  expect(screen.getByText("This snapshot has expired")).toBeTruthy();
});
