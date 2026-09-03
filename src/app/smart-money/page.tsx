"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type SmartWallet = {
  address: string;
  smartMoneyScore: number;
  labels: string[];
  tradeCount: number;
  realizedPnlUsd: number;
  winRate: number;
  netFlowUsd: number;
  recentAssets: string[];
  lastAction: string;
};

function formatAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatUsd(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function LabelBadge({ label }: { label: string }) {
  const colorMap: Record<string, string> = {
    SMART_MONEY: "bg-green-600",
    WHALE: "bg-blue-600",
    LP: "bg-purple-600",
    MARKET_MAKER: "bg-orange-600",
    BOT: "bg-red-600",
    DEPLOYER: "bg-yellow-600",
  };
  return (
    <Badge className={`${colorMap[label] || "bg-gray-600"} text-xs`}>
      {label.replace(/_/g, " ")}
    </Badge>
  );
}

export default function SmartMoneyPage() {
  const [wallets, setWallets] = useState<SmartWallet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/smart-money")
      .then((res) => res.json())
      .then((json) => {
        setWallets(json.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Smart Money</h1>
          <p className="text-muted-foreground mt-2">
            Wallet cohorts + accumulation tracking
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Smart Wallets ({wallets.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground py-8 text-center">Analyzing wallet patterns...</p>
            ) : wallets.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground mb-2">No smart wallets identified yet</p>
                <p className="text-sm text-muted-foreground">
                  Smart money wallets will appear after wallet feature scoring and trade analysis.
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  The engine scores wallets on realized PnL, win rate, entry timing, and consistency.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="p-2">Wallet</th>
                      <th className="p-2">Score</th>
                      <th className="p-2">Labels</th>
                      <th className="p-2 text-right">Trades</th>
                      <th className="p-2 text-right">PnL</th>
                      <th className="p-2 text-right">Win Rate</th>
                      <th className="p-2 text-right">Net Flow</th>
                      <th className="p-2">Assets</th>
                      <th className="p-2">Last Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wallets.map((w) => (
                      <tr key={w.address} className="border-b hover:bg-muted/50">
                        <td className="p-2 font-mono text-xs">
                          <a href={`https://robinhoodchain.blockscout.com/address/${w.address}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                            {formatAddress(w.address)}
                          </a>
                        </td>
                        <td className="p-2">
                          <Badge className={w.smartMoneyScore >= 70 ? "bg-green-600" : ""}>
                            {w.smartMoneyScore.toFixed(0)}
                          </Badge>
                        </td>
                        <td className="p-2 flex gap-1 flex-wrap">
                          {w.labels.map((l) => <LabelBadge key={l} label={l} />)}
                        </td>
                        <td className="p-2 text-right">{w.tradeCount}</td>
                        <td className="p-2 text-right">{formatUsd(w.realizedPnlUsd)}</td>
                        <td className="p-2 text-right">{(w.winRate * 100).toFixed(0)}%</td>
                        <td className="p-2 text-right">{formatUsd(w.netFlowUsd)}</td>
                        <td className="p-2">{w.recentAssets.join(", ") || "—"}</td>
                        <td className="p-2">{w.lastAction || "—"}</td>
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
