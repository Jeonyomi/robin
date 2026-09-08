import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { getStockTokensData, type Db, type StockTokenRow } from "../../src/lib/queries";

// Real Drizzle compiler/decoders, fake transport only: no environment or DB access.
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

type Row = Record<string, string | number | boolean | null>;
const metricColumns = ["token_address", "holder_count", "holder_delta", "unique_buyers", "unique_sellers", "net_flow_usd", "liquidity_usd", "depth_1pct_usd", "volume_usd", "top10_share", "data_completeness"];
const tokenRows: Row[] = [
  { address: "0xz", symbol: "Z", name: "Zed", decimals: 18, canonical_status: "CANONICAL", last_seen_at: "2026-01-03T00:00:00Z" },
  { address: "0xa", symbol: "A", name: "Alpha", decimals: 6, canonical_status: "NON_CANONICAL", last_seen_at: "2026-01-02T00:00:00Z" },
  { address: "0xempty", symbol: null, name: null, decimals: null, canonical_status: "CANONICAL", last_seen_at: null },
  { address: "0xnull", symbol: "NULL", canonical_status: "CANONICAL", last_seen_at: "2026-01-01T00:00:00Z" },
];
const canonicalRows: Row[] = [
  { id: "asset-z", contract_address: "0xZ", symbol: "Z", current_multiplier: "1.5", asset_status: "active" },
];
function metric(id: number, address: string, window: string, date: string, value: number | null): Row {
  return {
    ...Object.fromEntries(metricColumns.map((column) => [column, value])),
    id, token_address: address, window, calculated_at: date,
    active_holder_delta: 999, smart_money_flow_usd: 999, sybil_ratio: 999,
  };
}
const metrics = [
  metric(1, "0xz", "24h", "2026-01-01T00:00:00Z", 10),
  metric(2, "0xz", "24h", "2026-01-02T00:00:00Z", 20),
  metric(3, "0xa", "24h", "2026-01-03T00:00:00Z", 30),
  metric(4, "0xnull", "24h", "2026-01-01T01:00:00Z", 40),
  metric(5, "0xnull", "24h", "2026-01-04T00:00:00Z", null),
  metric(6, "0xz", "1h", "2026-01-05T00:00:00Z", 60),
  metric(7, "0xz", "6h", "2026-01-06T00:00:00Z", 70),
];

function fakeDatabase(sourceMetrics = metrics, sourceTokens = tokenRows) {
  const calls: { sql: string; params: unknown[]; columns: string[]; returnedRows: number }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[], options: { arrayMode: boolean }) => {
    expect(options.arrayMode).toBe(true);
    const table = sql.match(/ from "([^"]+)"/)?.[1];
    // Project the actual compiled SELECT list into Neon array-mode rows.
    const projection = sql.slice(0, sql.indexOf(" from ")).replace(/^select (?:distinct on \([^)]*\) )?/, "");
    const columns = projection.split(", ").map((column) => {
      const names = [...column.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      return names.at(-1)!;
    });
    let rows: Row[];
    if (table === "canonical_assets") rows = canonicalRows;
    else if (table === "tokens") rows = sourceTokens.filter((row) => !sql.includes(" where ") || row.canonical_status === params[0]);
    else if (table === "token_metric_snapshots") {
      const windowParam = sql.match(/"window" = \$(\d+)/);
      if (!windowParam) throw new Error(`Missing window predicate: ${sql}`);
      rows = sourceMetrics.filter((row) => row.window === params[Number(windowParam[1]) - 1]);
      const canonicalParam = sql.match(/"canonical_status" = \$(\d+)/);
      if (canonicalParam) {
        rows = rows.filter((row) => sourceTokens.some((token) => token.address === row.token_address && token.canonical_status === params[Number(canonicalParam[1]) - 1]));
      }
      const tieBreak = /"id" desc/.test(sql);
      rows = [...rows].sort((a, b) => String(b.calculated_at).localeCompare(String(a.calculated_at)) || (tieBreak ? Number(b.id) - Number(a.id) : 0));
      if (sql.startsWith("select distinct on")) {
        rows = rows.filter((row, index, all) => all.findIndex((candidate) => candidate.token_address === row.token_address) === index)
          .sort((a, b) => String(a.token_address).localeCompare(String(b.token_address)));
      }
    } else throw new Error(`Unexpected SQL: ${sql}`);
    calls.push({ sql, params, columns, returnedRows: rows.length });
    return { rows: rows.map((row) => columns.map((column) => row[column] ?? null)) };
  });
  const db = drizzle({ client: { query } as unknown as NeonQueryFunction<false, false> }) as Db;
  return { db, calls, metricCall: () => calls.find((call) => call.sql.includes('from "token_metric_snapshots"'))! };
}

// Independent oracle for the old window-filter + descending-sort + first-row Map.
// Unique timestamps only: ties had no defined legacy winner.
function legacyOutput(window: string, canonicalOnly: boolean): StockTokenRow[] {
  const latest = new Map<string, Row>();
  for (const row of metrics.filter((row) => row.window === window)
    .sort((a, b) => String(b.calculated_at).localeCompare(String(a.calculated_at)))) {
    if (!latest.has(String(row.token_address))) latest.set(String(row.token_address), row);
  }
  return tokenRows.filter((row) => !canonicalOnly || row.canonical_status === "CANONICAL").map((token) => {
    const row = latest.get(String(token.address));
    const canonical = canonicalRows.find((asset) => String(asset.contract_address).toLowerCase() === String(token.address).toLowerCase());
    return {
      address: String(token.address),
      symbol: token.symbol as string | null ?? null,
      name: token.name as string | null ?? null,
      decimals: token.decimals as number | null ?? null,
      canonicalStatus: token.canonical_status as string | null,
      canonicalAsset: canonical ? { id: String(canonical.id), symbol: String(canonical.symbol), multiplier: String(canonical.current_multiplier), status: String(canonical.asset_status) } : null,
      metrics: row ? {
        holderCount: row.holder_count as number | null,
        holderDelta: row.holder_delta as number | null,
        uniqueBuyers: row.unique_buyers as number | null,
        uniqueSellers: row.unique_sellers as number | null,
        netFlowUsd: row.net_flow_usd as number | null,
        liquidityUsd: row.liquidity_usd as number | null,
        depth1pctUsd: row.depth_1pct_usd as number | null,
        volumeUsd: row.volume_usd as number | null,
        top10Share: row.top10_share as number | null,
        dataCompleteness: row.data_completeness as number | null,
      } : null,
      lastSeenAt: token.last_seen_at == null ? null : new Date(String(token.last_seen_at)).toISOString(),
    };
  });
}

describe("stock token latest-metrics query cost", () => {
  it.each(["1h", "6h", "24h"])("preserves the legacy unique-timestamp output and token order for %s", async (window) => {
    for (const canonicalOnly of [false, true]) {
      const fake = fakeDatabase();
      const result = await getStockTokensData(fake.db, window, canonicalOnly);
      expect(result).toEqual(legacyOutput(window, canonicalOnly));
      expect(fake.metricCall().params).toEqual(canonicalOnly ? [window, "CANONICAL"] : [window]);
      if (!canonicalOnly) expect(fake.metricCall().sql).not.toContain('"canonical_status"');
      expect(fake.calls).toHaveLength(3);
    }
  });

  it("keeps a latest all-null snapshot rather than falling back to older populated metrics", async () => {
    const result = await getStockTokensData(fakeDatabase().db, "24h", false);
    const row = result.find((token) => token.address === "0xnull")!;
    expect(row.metrics).not.toBeNull();
    expect(Object.values(row.metrics!)).toEqual(Array(10).fill(null));
    expect(result.find((token) => token.address === "0xz")?.metrics?.holderCount).toBe(20);
  });

  it.each([false, true])("retains tokens with null metrics when no snapshots exist (canonicalOnly=%s)", async (canonicalOnly) => {
    const fake = fakeDatabase([]);
    const result = await getStockTokensData(fake.db, "24h", canonicalOnly);
    expect(result).toEqual(legacyOutput("24h", canonicalOnly).map((row) => ({ ...row, metrics: null })));
    expect(fake.metricCall().returnedRows).toBe(0);
  });

  it("returns an empty list when no tokens exist", async () => {
    for (const canonicalOnly of [false, true]) {
      expect(await getStockTokensData(fakeDatabase(metrics, []).db, "24h", canonicalOnly)).toEqual([]);
    }
  });

  it("uses highest id for equal-time snapshots regardless of transport fixture order", async () => {
    // Defensive tie contract; today's unique index normally prevents these ties.
    const tied = [metric(8, "0xz", "24h", "2026-01-07T00:00:00Z", 80), metric(9, "0xz", "24h", "2026-01-07T00:00:00Z", 90)];
    for (const rows of [tied, [...tied].reverse()]) {
      const fake = fakeDatabase(rows);
      const result = await getStockTokensData(fake.db, "24h", false);
      expect(fake.metricCall().sql).toContain('"token_metric_snapshots"."id" desc');
      expect(fake.metricCall().returnedRows).toBe(1);
      expect(result[0].metrics?.holderCount).toBe(90);
    }
  });

  it("preserves zero, negative and fractional metric values", async () => {
    const row = { ...metric(10, "0xz", "24h", "2026-01-08T00:00:00Z", 0), holder_delta: -2, net_flow_usd: -12.5, top10_share: 0.25 };
    const result = await getStockTokensData(fakeDatabase([row]).db, "24h", false);
    expect(result[0].metrics).toEqual({ holderCount: 0, holderDelta: -2, uniqueBuyers: 0, uniqueSellers: 0, netFlowUsd: -12.5, liquidityUsd: 0, depth1pctUsd: 0, volumeUsd: 0, top10Share: 0.25, dataCompleteness: 0 });
  });

  it("pushes canonical eligibility into the metric query without dropping metricless tokens", async () => {
    const fake = fakeDatabase();
    const result = await getStockTokensData(fake.db, "24h", true);
    const call = fake.metricCall();
    expect(call.sql).toContain('"token_metric_snapshots"."token_address" in (select "address" from "tokens" where "tokens"."canonical_status" = $2)');
    expect(call.sql).toContain('"token_metric_snapshots"."window" = $1');
    expect(call.params).toEqual(["24h", "CANONICAL"]);
    expect(call.returnedRows).toBe(2);
    expect(result.map((row) => row.address)).toEqual(["0xz", "0xempty", "0xnull"]);
    expect(result.find((row) => row.address === "0xempty")?.metrics).toBeNull();
  });

  it("selects only the latest projected metric per token in compiled SQL", async () => {
    const fake = fakeDatabase();
    await getStockTokensData(fake.db, "24h", false);
    const call = fake.metricCall();
    expect(call.sql).toMatch(/^select distinct on \("token_metric_snapshots"\."token_address"\)/);
    expect(call.columns).toEqual(metricColumns);
    expect(call.sql).toContain('order by "token_metric_snapshots"."token_address", "token_metric_snapshots"."calculated_at" desc, "token_metric_snapshots"."id" desc');
    expect(call.sql).toContain('where "token_metric_snapshots"."window" = $1');
    expect(call.params).toEqual(["24h"]);
    expect(call.returnedRows).toBe(3);
    expect(fake.calls).toHaveLength(3);
  });
});
