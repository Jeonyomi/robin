"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type CapitalFlowData = {
  bridgeInflow: number;
  bridgeOutflow: number;
  netFlow: number;
  usdgFlow: number;
  wethFlow: number;
  topDestinations: Array<{
    symbol: string;
    address: string;
    flowUsd: number;
    type: string;
  }>;
  timeline: Array<{
    timestamp: string;
    bridgeIn: number;
    bridgeOut: number;
    dexBuy: number;
    dexSell: number;
  }>;
};

function formatUsd(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export default function CapitalFlowPage() {
  const [data, setData] = useState<CapitalFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [window, setWindow] = useState("24h");

  useEffect(() => {
    fetch(`/api/v1/capital-flow?window=${window}`)
      .then((res) => res.json())
      .then((json) => {
        setData(json.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [window]);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Capital Flow</h1>
          <p className="text-muted-foreground mt-2">
            Bridge → Stablecoin → DEX → Protocol flow analysis
          </p>
        </header>

        {/* Window selector */}
        <div className="flex gap-2 mb-6">
          {["1h", "6h", "24h", "7d"].map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`px-3 py-1.5 rounded-md text-sm ${
                window === w ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
              }`}
            >
              {w}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-muted-foreground py-8 text-center">Loading capital flow data...</p>
        ) : (
          <>
            {/* Flow KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Bridge Inflow</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-green-500">{formatUsd(data?.bridgeInflow || 0)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Bridge Outflow</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-red-500">{formatUsd(data?.bridgeOutflow || 0)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Net Flow</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className={`text-2xl font-bold ${(data?.netFlow || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatUsd(data?.netFlow || 0)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">USDG Net Flow</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{formatUsd(data?.usdgFlow || 0)}</p>
                </CardContent>
              </Card>
            </div>

            {/* Flow Timeline */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Capital Flow Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                {data?.timeline && data.timeline.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="p-2 text-left">Time</th>
                          <th className="p-2 text-right">Bridge In</th>
                          <th className="p-2 text-right">Bridge Out</th>
                          <th className="p-2 text-right">DEX Buy</th>
                          <th className="p-2 text-right">DEX Sell</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.timeline.map((t, i) => (
                          <tr key={i} className="border-b">
                            <td className="p-2">{new Date(t.timestamp).toLocaleTimeString()}</td>
                            <td className="p-2 text-right text-green-500">{formatUsd(t.bridgeIn)}</td>
                            <td className="p-2 text-right text-red-500">{formatUsd(t.bridgeOut)}</td>
                            <td className="p-2 text-right text-green-500">{formatUsd(t.dexBuy)}</td>
                            <td className="p-2 text-right text-red-500">{formatUsd(t.dexSell)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground mb-2">No flow data available yet</p>
                    <p className="text-sm text-muted-foreground">
                      Bridge events will populate this timeline after on-chain ingestion.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top Destinations */}
            <Card>
              <CardHeader>
                <CardTitle>Top Capital Destinations</CardTitle>
              </CardHeader>
              <CardContent>
                {data?.topDestinations && data.topDestinations.length > 0 ? (
                  <div className="space-y-2">
                    {data.topDestinations.map((dest) => (
                      <div key={dest.address} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <span className="font-medium">{dest.symbol}</span>
                          <Badge variant="outline" className="ml-2 text-xs">{dest.type}</Badge>
                        </div>
                        <span className="font-mono text-sm">{formatUsd(dest.flowUsd)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">No destination data available yet</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
