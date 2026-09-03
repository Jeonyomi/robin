"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { WatchlistButton } from "@/components/watchlist-button";

type TokenDetail = {
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  canonicalStatus: string;
  canonicalAsset: {
    id: string;
    symbol: string;
    multiplier: string | null;
    status: string;
  } | null;
  isVerified: boolean | null;
  metrics: {
    holderCount: number | null;
    holderDelta: number | null;
    uniqueBuyers: number | null;
    uniqueSellers: number | null;
    netFlowUsd: string | null;
    liquidityUsd: string | null;
    depth1pctUsd: string | null;
    volumeUsd: string | null;
    top10Share: string | null;
    dataCompleteness: number | null;
  } | null;
  signals: Array<{
    id: string;
    type: string;
    rawScore: number;
    riskScore: number;
    adjustedScore: number;
    confidence: string;
  }>;
};

function CanonicalBadge({ status }: { status: string }) {
  if (status === "CANONICAL") return <Badge className="bg-green-600">✓ Canonical</Badge>;
  if (status === "NON_CANONICAL") return <Badge variant="destructive">⚠ Non-Canonical</Badge>;
  if (status === "TICKER_COLLISION") return <Badge variant="destructive">⚠ Ticker Collision</Badge>;
  return <Badge variant="secondary">Unknown</Badge>;
}

function formatUsd(value: string | number | null) {
  if (value === null) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

type Tab = "overview" | "flows" | "signals" | "risk" | "transactions";

export default function TokenDetailPage() {
  const params = useParams();
  const address = params.address as string;
  const [token, setToken] = useState<TokenDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  useEffect(() => {
    fetch(`/api/v1/tokens/${address}`)
      .then((res) => res.json())
      .then((json) => {
        setToken(json.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [address]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          <p className="text-muted-foreground py-12 text-center">Loading token data...</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-4">Token Not Found</h1>
          <p className="text-muted-foreground mb-4">No token found at address {address}</p>
          <Link href="/tokens" className="text-primary hover:underline">← Back to Token Scanner</Link>
        </div>
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "flows", label: "Flows" },
    { id: "signals", label: "Signals" },
    { id: "risk", label: "Risk" },
    { id: "transactions", label: "Transactions" },
  ];

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <Link href="/tokens" className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block">
          ← Back to Token Scanner
        </Link>

        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold">{token.symbol || "Unknown"}</h1>
            <CanonicalBadge status={token.canonicalStatus} />
            {token.isVerified && <Badge variant="outline">✓ Verified</Badge>}
            <WatchlistButton address={token.address} />
          </div>
          <p className="text-muted-foreground">{token.name}</p>
          <p className="text-sm font-mono text-muted-foreground mt-1">
            {token.address}
            <a
              href={`https://robinhoodchain.blockscout.com/token/${token.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 text-primary hover:underline"
            >
              View on Blockscout ↗
            </a>
          </p>
        </header>

        {/* Canonical Info */}
        {token.canonicalAsset && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Canonical Stock Token</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Asset ID</p>
                  <p className="font-mono text-sm">{token.canonicalAsset.id}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Multiplier</p>
                  <p className="font-mono text-sm">{token.canonicalAsset.multiplier || "1.0"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Status</p>
                  <p className="text-sm">{token.canonicalAsset.status || "Active"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Symbol</p>
                  <p className="font-mono text-sm">{token.canonicalAsset.symbol}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Activity Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                {token.metrics ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase">Holders</p>
                      <p className="text-xl font-bold">{token.metrics.holderCount?.toLocaleString() || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase">Volume (24h)</p>
                      <p className="text-xl font-bold">{formatUsd(token.metrics.volumeUsd)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase">Liquidity</p>
                      <p className="text-xl font-bold">{formatUsd(token.metrics.liquidityUsd)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase">Depth ±1%</p>
                      <p className="text-xl font-bold">{formatUsd(token.metrics.depth1pctUsd)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase">Net Flow</p>
                      <p className="text-xl font-bold">{formatUsd(token.metrics.netFlowUsd)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase">Data Completeness</p>
                      <p className="text-xl font-bold">
                        {token.metrics.dataCompleteness ? `${(token.metrics.dataCompleteness * 100).toFixed(0)}%` : "—"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">No metrics available yet. Data will populate after sync.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <a
                    href={`https://robinhoodchain.blockscout.com/token/${token.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-3 border rounded-lg hover:bg-muted/50 text-sm"
                  >
                    View on Blockscout ↗
                  </a>
                  <a
                    href={`https://robinhoodchain.blockscout.com/address/${token.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-3 border rounded-lg hover:bg-muted/50 text-sm"
                  >
                    View Contract ↗
                  </a>
                  <button
                    onClick={() => navigator.clipboard.writeText(token.address)}
                    className="block w-full p-3 border rounded-lg hover:bg-muted/50 text-sm text-left"
                  >
                    Copy Address
                  </button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "signals" && (
          <Card>
            <CardHeader>
              <CardTitle>Active Signals ({token.signals.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {token.signals.length === 0 ? (
                <p className="text-muted-foreground text-sm py-4">
                  No active signals for this token. Signals will appear after metric calculation.
                </p>
              ) : (
                <div className="space-y-3">
                  {token.signals.map((signal) => (
                    <div key={signal.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <p className="font-medium">{signal.type.replace(/_/g, " ")}</p>
                        <p className="text-sm text-muted-foreground">
                          Raw: {signal.rawScore.toFixed(1)} · Risk: {signal.riskScore.toFixed(1)} · Adjusted: {signal.adjustedScore.toFixed(1)}
                        </p>
                      </div>
                      <Badge variant={signal.confidence === "HIGH" ? "default" : "secondary"}>
                        {signal.confidence}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "flows" && (
          <Card>
            <CardHeader>
              <CardTitle>Capital Flows</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm py-4">
                Flow data will appear after bridge and DEX event ingestion. Check back after the next data sync.
              </p>
            </CardContent>
          </Card>
        )}

        {activeTab === "risk" && (
          <Card>
            <CardHeader>
              <CardTitle>Risk Assessment</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm py-4">
                Risk scoring will be computed after contract analysis and holder concentration data is available.
              </p>
            </CardContent>
          </Card>
        )}

        {activeTab === "transactions" && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Transactions</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm py-4">
                Transaction history will be indexed from Blockscout after on-chain sync.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
