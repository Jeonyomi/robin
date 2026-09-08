// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Overview from "../../src/app/page";
import Transfers from "../../src/app/capital-flow/page";
import Registry from "../../src/app/stock-tokens/page";
import ActivityLens from "../../src/app/opportunities/page";

vi.mock("@/components/charts/activity-timeline", () => ({ ActivityTimelineChart: () => null }));
vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const NOW = Date.parse("2026-09-08T12:00:00Z");
let host: HTMLDivElement;
let root: Root;
function observation() {
  return {
    chain: { observedAt: "2026-09-07T12:00:00Z" },
    gas: { updatedAt: "2026-09-08T11:59:00Z" },
    activity: { lastObservedAt: "2026-09-08T11:59:00Z" },
    coverage: { completedCycles: 61, cycleProgressPct: 30, scannedInCycle: 3, trackedTokens: 10, lastIndexedAt: "2026-09-08T11:59:30Z", status: "success" },
    dataQuality: { note: "Bounded sample" }, timeline: [], recentTransfers: [],
    lastUpdatedAt: "2026-09-08T11:59:30Z",
  };
}
async function mount(component: typeof Overview, data: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data }) })));
  await act(async () => root.render(React.createElement(component)));
}
function source(label: string) {
  const row = [...host.querySelectorAll('[aria-label="Observation freshness"] .status-line')].find((row) => row.textContent?.includes(label));
  expect(row, `separate ${label} timestamp`).toBeDefined();
  return row!.textContent;
}
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each([{ name: "Overview", component: Overview }, { name: "Transfer Activity", component: Transfers }])("$name observation status", ({ component }) => {
  it("labels RPC as a recent sample with gaps, never a completed rotation", async () => {
    const data = observation();
    await mount(component, { ...data, coverage: { ...data.coverage, source: "rpc", collectionMode: "bounded-recent-rpc", scanFromBlock: 1000, scannedToBlock: 1063, skippedBlocks: 500 } });
    const banner = host.querySelector(".scope-banner")?.textContent;
    expect(banner).toContain("48-block");
    expect(banner).toContain("500");
    expect(banner).toContain("mixed historical Blockscout/RPC");
    expect(banner).not.toContain("prior completed rotations");
  });
  it("labels observed token share separately from unverified scan completeness", async () => {
    const data = observation();
    await mount(component, { ...data, coverage: { ...data.coverage, observedTokensInWindow: 3, observationExposureVerified: false } });
    const banner = host.querySelector(".scope-banner")?.textContent;
    expect(banner).toContain("3 of 10 canonical tokens with observed transfers in this window");
    expect(banner).toContain("rotation progress is not scan completeness");
    expect(banner).toContain("Continuous observation exposure is unverified");
  });

  it("does not relabel all-time counts in old snapshots as window observations", async () => {
    const data = observation();
    await mount(component, { ...data, coverage: { ...data.coverage, tokensWithStoredTransfers: 10 } });
    expect(host.querySelector(".scope-banner")?.textContent).toContain("Unknown of 10 canonical tokens with observed transfers in this window");
  });

  it("shows 30% CURRENT rotation despite 61 prior completed rotations", async () => {
    await mount(component, observation());
    expect(host.querySelector(".scope-banner")?.textContent).toContain("30% of current rotation");
    expect(host.querySelector(".scope-banner")?.textContent).toContain("61 prior completed rotations");
    expect(host.querySelector<HTMLElement>(".coverage-track > span")?.style.width).toBe("30%");
  });

  it("does not let new transfers or overall latest time imply the chain is fresh", async () => {
    await mount(component, observation());
    expect(source("CHAIN OBSERVED")).toContain("Stale");
    expect(source("GAS UPDATED")).toContain("Fresh");
    expect(source("TRANSFER OBSERVED")).toContain("Fresh");
    expect(source("TRANSFER INDEXED")).toContain("Fresh");
  });

  it("labels missing, invalid, and future source timestamps explicitly", async () => {
    const data = observation();
    data.chain.observedAt = "invalid";
    data.gas.updatedAt = "";
    data.activity.lastObservedAt = "2026-09-09T12:00:00Z";
    data.coverage.lastIndexedAt = "2026-09-09T12:00:00Z";
    await mount(component, data);
    expect(source("CHAIN OBSERVED")).toContain("Unknown");
    expect(source("GAS UPDATED")).toContain("Unknown");
    expect(source("TRANSFER OBSERVED")).toContain("Future timestamp");
    expect(source("TRANSFER INDEXED")).toContain("Future timestamp");
  });

  it("uses response-time freshness for observations after mount while preserving genuinely future warnings", async () => {
    vi.useFakeTimers();
    const data = observation();
    data.chain.observedAt = "2026-09-08T12:00:10Z";
    data.gas.updatedAt = "2026-09-08T12:00:10Z";
    data.activity.lastObservedAt = "2026-09-08T12:00:10Z";
    data.coverage.lastIndexedAt = "2026-09-08T12:00:30Z";
    let respond!: (response: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { respond = resolve; })));
    await act(async () => root.render(React.createElement(component)));
    expect(source("CHAIN OBSERVED")).toContain("Unknown");

    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-08T12:00:20Z"));
    await act(async () => respond({ ok: true, json: async () => ({ data }) }));
    for (const label of ["CHAIN OBSERVED", "GAS UPDATED", "TRANSFER OBSERVED"]) {
      expect.soft(source(label)).toContain("Fresh · <1m ago");
      expect.soft(source(label)).not.toContain("Future timestamp");
    }
    expect(source("TRANSFER INDEXED")).toContain("Future timestamp · check source clock");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("ages the freshness labels without refetching and clears the clock on unmount", async () => {
    vi.useFakeTimers();
    await mount(component, observation());
    expect(source("GAS UPDATED")).toContain("Fresh");
    vi.spyOn(Date, "now").mockReturnValue(NOW + 4 * 60 * 60 * 1000);
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(source("GAS UPDATED")).toContain("Stale");
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(host);
  });
});

it("explains that Activity Lens requires verified exposure even before current gate metadata arrives", async () => {
  await mount(ActivityLens, []);
  expect(host.querySelector(".scope-note")?.textContent).toContain("verified comparable observation exposure");
  expect(host.querySelector(".scope-note")?.textContent).not.toContain("stored-transfer coverage");
});

it("defers Overview gas age to the ticking freshness panel without contradictory gas notes", async () => {
  vi.useFakeTimers();
  await mount(Overview, observation());
  expect(source("GAS UPDATED")).toContain("Fresh");

  vi.spyOn(Date, "now").mockReturnValue(NOW + 4 * 60 * 60 * 1000);
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(source("GAS UPDATED")).toContain("Stale");

  const gasMetric = [...host.querySelectorAll(".metric-block")].find((metric) => metric.querySelector(".metric-label")?.textContent === "SUGGESTED GAS");
  const notes = [gasMetric?.querySelector(".metric-note"), host.querySelector(".chain-panel .gas-note")];
  for (const note of notes) {
    expect(note).toBeTruthy();
    expect.soft(note?.textContent).not.toMatch(/\b(Fresh|Stale)\b|\b\d+\s*(s|m|h|d|seconds?|minutes?|hours?|days?)\s+ago\b/i);
    expect.soft(note?.textContent).toContain("See Observation freshness for gas age");
  }
  expect(fetch).toHaveBeenCalledTimes(1);
});

describe.each([
  { name: "Overview", component: Overview, selectors: [".toolbar > p", ".recent-panel tbody tr td:nth-child(6)"] },
  { name: "Transfer Activity", component: Transfers, selectors: [".recent-panel tbody tr td:first-child"] },
  { name: "Registry", component: Registry, selectors: [".registry-panel tbody tr td:nth-child(6)"] },
])("$name static timestamps", ({ component, selectors }) => {
  it("shows immutable ISO timestamps rather than non-ticking freshness claims", async () => {
    vi.useFakeTimers();
    const timestamp = "2026-09-08T11:59:00Z";
    const data = component === Registry
      ? [{ address: "0x1234", symbol: "ASSET", canonicalStatus: "CANONICAL", lastSeenAt: timestamp }]
      : { ...observation(), recentTransfers: [{ timestamp, txHash: "0x1234", logIndex: 0, symbol: "ASSET", tokenAddress: "0x1234", fromAddress: "0x5678", toAddress: "0x9012", blockNumber: 123, kind: "transfer" }] };
    await mount(component, data);

    for (const elapsed of [0, 4 * 60 * 60 * 1000]) {
      vi.spyOn(Date, "now").mockReturnValue(NOW + elapsed);
      await act(async () => vi.advanceTimersByTime(60_000));
      for (const selector of selectors) {
        const timestampCell = host.querySelector(selector);
        expect(timestampCell, selector).not.toBeNull();
        expect.soft(timestampCell?.textContent).not.toMatch(/\b(Fresh|Stale)\b|\b\d+\s*(s|m|h|d|seconds?|minutes?|hours?|days?)\s+ago\b/i);
        expect.soft(timestampCell?.textContent).toContain("2026-09-08T11:59:00.000Z");
      }
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it("distinguishes the provider block count and fetch age from chain head freshness", async () => {
  await mount(Overview, observation());
  const counters = host.querySelector(".chain-list")?.textContent;
  expect(counters).toContain("Indexed block count");
  expect(counters).not.toContain("Block height");
  expect(counters).toContain("Latest tracked block");
  expect(host.querySelector('[aria-label="Observation freshness"] .metric-note')?.textContent)
    .toContain("Chain observed is the last accepted stats fetch, not the chain head time; provider counters may lag.");
});

it("keeps missing/invalid/future registry metadata dates distinct from holder observations", async () => {
  await mount(Registry, [null, "invalid", "2026-09-09T12:00:00Z"].map((lastSeenAt, index) => ({ address: `0x${index}`, symbol: `ASSET${index}`, canonicalStatus: "CANONICAL", lastSeenAt, metrics: { holderCount: 123 } })));
  const rows = [...host.querySelectorAll("tbody tr")];
  expect(rows[0].children[5].textContent).toContain("Unknown");
  expect(rows[1].children[5].textContent).toContain("Unknown");
  expect(rows[2].children[5].textContent).toContain("Future timestamp");
  expect(rows[0].children[2].textContent).toBe("123");
});
