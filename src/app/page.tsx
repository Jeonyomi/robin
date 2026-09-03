"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

type OverviewData = {
  netCapitalInflow24h: number;
  activeWallets24h: number;
  dexVolume24h: number;
  usdgNetFlow24h: number;
  signals24h: number;
  highRiskAlerts: number;
  tokenCount: number;
  lastUpdatedAt: string;
};

function MetricCard({ title, value, subtitle, trend, link }: {
  title: string;
  value: string;
  subtitle?: string;
  trend?: "positive" | "negative" | "neutral";
  link?: string;
}) {
  const content = (
    <Card className={link ? "hover:border-primary/50 transition-colors" : ""}>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        {trend && (
          <div className="mt-1">
            <Badge
              variant={trend === "positive" ? "default" : trend === "negative" ? "destructive" : "secondary"}
              className="text-xs"
            >
              {trend === "positive" ? "↑ Inflow" : trend === "negative" ? "↓ Outflow" : "—"}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (link) {
    return <Link href={link}>{content}</Link>;
  }
  return content;
}

function formatUsd(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export default function DashboardPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/overview")
      .then((res) => res.json())
      .then((json) => {
        setData(json.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Chain Pulse</h1>
          <p className="text-muted-foreground mt-1">
            Robinhood Chain · Chain ID 4663 · Last indexed:{" "}
            {data?.lastUpdatedAt ? new Date(data.lastUpdatedAt).toLocaleString() : "Not yet indexed"}
          </p>
        </header>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <MetricCard
            title="Net Capital Inflow"
            value={formatUsd(data?.netCapitalInflow24h || 0)}
            subtitle="24h"
            trend={(data?.netCapitalInflow24h || 0) > 0 ? "positive" : "neutral"}
          />
          <MetricCard
            title="Active Wallets"
            value={(data?.activeWallets24h || 0).toLocaleString()}
            subtitle="24h"
          />
          <MetricCard
            title="DEX Volume"
            value={formatUsd(data?.dexVolume24h || 0)}
            subtitle="24h"
          />
          <MetricCard
            title="USDG Flow"
            value={formatUsd(data?.usdgNetFlow24h || 0)}
            subtitle="24h"
          />
          <MetricCard
            title="Signals"
            value={(data?.signals24h || 0).toString()}
            subtitle="24h"
            link="/alerts"
          />
          <MetricCard
            title="Risk Alerts"
            value={(data?.highRiskAlerts || 0).toString()}
            subtitle="Active"
            trend={data?.highRiskAlerts ? "negative" : "neutral"}
            link="/alerts"
          />
        </div>

        {/* Quick access panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Link href="/opportunities">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>🎯</span> Opportunity Radar
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Risk-adjusted opportunity leaderboard across all tracked assets.
                  Filter by category, risk, and liquidity.
                </p>
                <Badge variant="outline" className="mt-3">Open →</Badge>
              </CardContent>
            </Card>
          </Link>

          <Link href="/stock-tokens">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>📈</span> Stock Token Radar
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Canonical identity verification + flow + relative value analysis
                  for Robinhood Stock Tokens.
                </p>
                <Badge variant="outline" className="mt-3">Open →</Badge>
              </CardContent>
            </Card>
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Link href="/capital-flow">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>💰</span> Capital Flow
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Bridge inflow/outflow, USDG movement, and destination tracking.
                </p>
                <Badge variant="outline" className="mt-3">Open →</Badge>
              </CardContent>
            </Card>
          </Link>

          <Link href="/smart-money">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>🧠</span> Smart Money
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Wallet scoring, accumulation tracking, and smart cohort analysis.
                </p>
                <Badge variant="outline" className="mt-3">Open →</Badge>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
