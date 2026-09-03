"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  } | null;
};

function CanonicalBadge({ status }: { status: string }) {
  if (status === "CANONICAL") {
    return <Badge className="bg-green-600 hover:bg-green-700">✓ Canonical</Badge>;
  }
  if (status === "NON_CANONICAL") {
    return <Badge variant="destructive">⚠ Non-Canonical</Badge>;
  }
  if (status === "TICKER_COLLISION") {
    return <Badge variant="destructive">⚠ Ticker Collision</Badge>;
  }
  return <Badge variant="secondary">Unknown</Badge>;
}

export default function StockTokensPage() {
  const [tokens, setTokens] = useState<StockToken[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/stock-tokens")
      .then((res) => res.json())
      .then((json) => {
        setTokens(json.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-6">Stock Token Radar</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Stock Token Radar</h1>
          <p className="text-muted-foreground mt-2">
            Canonical identity + flow + relative value analysis
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Stock Tokens ({tokens.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Symbol</th>
                    <th className="text-left p-2">Name</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Multiplier</th>
                    <th className="text-right p-2">Holders</th>
                    <th className="text-right p-2">Volume</th>
                    <th className="text-right p-2">Liquidity</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => (
                    <tr key={token.address} className="border-b hover:bg-muted/50">
                      <td className="p-2 font-mono">{token.symbol}</td>
                      <td className="p-2">{token.name}</td>
                      <td className="p-2">
                        <CanonicalBadge status={token.canonicalStatus} />
                      </td>
                      <td className="p-2">{token.canonicalAsset?.multiplier || "—"}</td>
                      <td className="p-2 text-right">{token.metrics?.holderCount?.toLocaleString() || "—"}</td>
                      <td className="p-2 text-right">${token.metrics?.volumeUsd ? Number(token.metrics.volumeUsd).toLocaleString() : "—"}</td>
                      <td className="p-2 text-right">${token.metrics?.liquidityUsd ? Number(token.metrics.liquidityUsd).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
