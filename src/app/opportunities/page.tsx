"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Opportunity = {
  rank: number;
  symbol: string;
  address: string;
  category: string;
  adjustedScore: number;
  rawScore: number;
  riskScore: number;
  netFlow1h: number;
  netFlow24h: number;
  uniqueBuyersDelta: number;
  holderDelta: number;
  liquidityUsd: number;
  depth1pctUsd: number;
  smartMoneyFlow: number;
  catalyst: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  status: "ACTIVE" | "RESTRICTED" | "INSUFFICIENT_DATA";
};

function ScoreBadge({ score, type }: { score: number; type: "opportunity" | "risk" }) {
  if (type === "opportunity") {
    if (score >= 70) return <Badge className="bg-green-600">{score.toFixed(0)}</Badge>;
    if (score >= 40) return <Badge className="bg-yellow-600">{score.toFixed(0)}</Badge>;
    return <Badge variant="secondary">{score.toFixed(0)}</Badge>;
  }
  if (score >= 60) return <Badge variant="destructive">{score.toFixed(0)}</Badge>;
  if (score >= 30) return <Badge className="bg-yellow-600">{score.toFixed(0)}</Badge>;
  return <Badge variant="secondary">{score.toFixed(0)}</Badge>;
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  if (confidence === "HIGH") return <Badge className="bg-green-600">High</Badge>;
  if (confidence === "MEDIUM") return <Badge className="bg-yellow-600">Medium</Badge>;
  return <Badge variant="secondary">Low</Badge>;
}

function formatAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatUsd(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export default function OpportunitiesPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    category: "all",
    canonicalOnly: false,
    riskMax: 100,
    window: "24h",
  });

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.category !== "all") params.set("category", filters.category);
    if (filters.canonicalOnly) params.set("canonicalOnly", "true");
    if (filters.riskMax < 100) params.set("riskMax", filters.riskMax.toString());
    params.set("window", filters.window);

    fetch(`/api/v1/opportunities?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        setOpportunities(json.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [filters]);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Opportunity Radar</h1>
          <p className="text-muted-foreground mt-2">
            Risk-adjusted opportunity leaderboard across all tracked assets
          </p>
        </header>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4 items-center">
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Category</label>
                <select
                  value={filters.category}
                  onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                  className="px-3 py-1.5 border rounded-md bg-background text-sm"
                >
                  <option value="all">All</option>
                  <option value="stock-token">Stock Token</option>
                  <option value="erc20">ERC-20</option>
                  <option value="lp">LP</option>
                  <option value="lending">Lending</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Window</label>
                <select
                  value={filters.window}
                  onChange={(e) => setFilters({ ...filters, window: e.target.value })}
                  className="px-3 py-1.5 border rounded-md bg-background text-sm"
                >
                  <option value="1h">1h</option>
                  <option value="6h">6h</option>
                  <option value="24h">24h</option>
                  <option value="7d">7d</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="canonicalOnly"
                  checked={filters.canonicalOnly}
                  onChange={(e) => setFilters({ ...filters, canonicalOnly: e.target.checked })}
                  className="rounded"
                />
                <label htmlFor="canonicalOnly" className="text-sm">Canonical Only</label>
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Max Risk: {filters.riskMax}</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={filters.riskMax}
                  onChange={(e) => setFilters({ ...filters, riskMax: Number(e.target.value) })}
                  className="w-32"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle>Opportunities ({opportunities.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground py-8 text-center">Loading opportunities...</p>
            ) : opportunities.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground mb-2">No opportunities computed yet</p>
                <p className="text-sm text-muted-foreground">
                  Opportunities will appear after canonical asset sync and metric calculation.
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Run the canonical sync from Data Sources → Admin Sync.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="p-2">#</th>
                      <th className="p-2">Asset</th>
                      <th className="p-2">Category</th>
                      <th className="p-2 text-center">Opp.</th>
                      <th className="p-2 text-center">Risk</th>
                      <th className="p-2 text-right">Net Flow 1h</th>
                      <th className="p-2 text-right">Net Flow 24h</th>
                      <th className="p-2 text-right">Liquidity</th>
                      <th className="p-2 text-right">Depth ±1%</th>
                      <th className="p-2 text-right">Smart $</th>
                      <th className="p-2 text-center">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opportunities.map((opp) => (
                      <tr key={opp.address} className="border-b hover:bg-muted/50">
                        <td className="p-2 font-mono">{opp.rank}</td>
                        <td className="p-2">
                          <a href={`/tokens/${opp.address}`} className="hover:underline">
                            <span className="font-medium">{opp.symbol}</span>
                            <span className="text-muted-foreground ml-2">{formatAddress(opp.address)}</span>
                          </a>
                        </td>
                        <td className="p-2"><Badge variant="outline">{opp.category}</Badge></td>
                        <td className="p-2 text-center"><ScoreBadge score={opp.adjustedScore} type="opportunity" /></td>
                        <td className="p-2 text-center"><ScoreBadge score={opp.riskScore} type="risk" /></td>
                        <td className="p-2 text-right">{formatUsd(opp.netFlow1h)}</td>
                        <td className="p-2 text-right">{formatUsd(opp.netFlow24h)}</td>
                        <td className="p-2 text-right">{formatUsd(opp.liquidityUsd)}</td>
                        <td className="p-2 text-right">{formatUsd(opp.depth1pctUsd)}</td>
                        <td className="p-2 text-right">{formatUsd(opp.smartMoneyFlow)}</td>
                        <td className="p-2 text-center"><ConfidenceBadge confidence={opp.confidence} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
