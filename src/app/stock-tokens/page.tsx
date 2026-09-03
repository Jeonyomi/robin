"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type StockToken = {
  address: string;
  symbol: string;
  name: string | null;
  canonicalStatus: string;
  canonicalAsset: {
    id: string;
    symbol: string;
    multiplier: string | null;
    status: string;
  } | null;
  metrics: {
    holderCount: number | null;
    holderDelta: number | null;
    uniqueBuyers: number | null;
    netFlowUsd: string | null;
    liquidityUsd: string | null;
    volumeUsd: string | null;
    depth1pctUsd: string | null;
    dataCompleteness: number | null;
  } | null;
  lastSeenAt: string;
};

function CanonicalBadge({ status }: { status: string }) {
  if (status === "CANONICAL") {
    return <Badge className="bg-green-600 text-xs">✓ Canonical</Badge>;
  }
  if (status === "NON_CANONICAL") {
    return <Badge variant="destructive" className="text-xs">⚠ Non-Canonical</Badge>;
  }
  if (status === "TICKER_COLLISION") {
    return <Badge variant="destructive" className="text-xs">⚠ Ticker Collision</Badge>;
  }
  return <Badge variant="secondary" className="text-xs">Unknown</Badge>;
}

function formatAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatUsd(value: string | number | null) {
  if (value === null) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

export default function StockTokensPage() {
  const [tokens, setTokens] = useState<StockToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [canonicalOnly, setCanonicalOnly] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (canonicalOnly) params.set("canonicalOnly", "true");

    fetch(`/api/v1/stock-tokens?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        setTokens(json.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [canonicalOnly]);

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Stock Token Radar</h1>
          <p className="text-muted-foreground mt-1">
            Canonical identity + flow + relative value analysis
          </p>
        </header>

        {/* Controls */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="canonicalOnly"
              checked={canonicalOnly}
              onChange={(e) => setCanonicalOnly(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="canonicalOnly" className="text-sm">Canonical Only</label>
          </div>
          <Badge variant="outline">{tokens.length} tokens</Badge>
        </div>

        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <p className="text-muted-foreground py-8 text-center">Loading stock tokens...</p>
            ) : tokens.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground mb-2">No stock tokens indexed yet</p>
                <p className="text-sm text-muted-foreground">
                  Run the canonical asset sync from Data Sources → Admin Sync to populate this radar.
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Stock Tokens will be verified against Robinhood&apos;s official <code>/rhj/assets</code> registry.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="p-2">Symbol</th>
                      <th className="p-2">Name</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Multiplier</th>
                      <th className="p-2">Contract</th>
                      <th className="p-2 text-right">Holders</th>
                      <th className="p-2 text-right">Buyers</th>
                      <th className="p-2 text-right">Volume</th>
                      <th className="p-2 text-right">Liquidity</th>
                      <th className="p-2 text-right">Depth ±1%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((token) => (
                      <tr key={token.address} className="border-b hover:bg-muted/50">
                        <td className="p-2 font-medium">{token.symbol}</td>
                        <td className="p-2 text-muted-foreground">{token.name || "—"}</td>
                        <td className="p-2"><CanonicalBadge status={token.canonicalStatus} /></td>
                        <td className="p-2 font-mono text-xs">{token.canonicalAsset?.multiplier || "1.0"}</td>
                        <td className="p-2">
                          <a
                            href={`https://robinhoodchain.blockscout.com/token/${token.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-muted-foreground hover:text-foreground"
                          >
                            {formatAddress(token.address)} ↗
                          </a>
                        </td>
                        <td className="p-2 text-right">{token.metrics?.holderCount?.toLocaleString() || "—"}</td>
                        <td className="p-2 text-right">{token.metrics?.uniqueBuyers?.toLocaleString() || "—"}</td>
                        <td className="p-2 text-right">{formatUsd(token.metrics?.volumeUsd || null)}</td>
                        <td className="p-2 text-right">{formatUsd(token.metrics?.liquidityUsd || null)}</td>
                        <td className="p-2 text-right">{formatUsd(token.metrics?.depth1pctUsd || null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Legend */}
        <div className="mt-4 text-xs text-muted-foreground space-y-1">
          <p><strong>Canonical</strong>: Verified against Robinhood&apos;s official <code>/rhj/assets</code> registry by contract address exact match.</p>
          <p><strong>Non-Canonical</strong>: Token exists on-chain but is NOT the official Stock Token — possible lookalike or ticker collision.</p>
          <p><strong>Ticker Collision</strong>: Multiple tokens share the same symbol — this is NOT the canonical version.</p>
        </div>
      </div>
    </div>
  );
}
