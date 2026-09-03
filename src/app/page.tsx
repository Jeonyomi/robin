"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type OverviewData = {
  netCapitalInflow24h: number;
  activeWallets24h: number;
  dexVolume24h: number;
  usdgNetFlow24h: number;
  signals24h: number;
  highRiskAlerts: number;
  lastUpdatedAt: string;
};

function MetricCard({ title, value, unit, trend }: { title: string; value: string; unit?: string; trend?: "up" | "down" | "neutral" }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {value}
          {unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
        </div>
        {trend && (
          <Badge variant={trend === "up" ? "default" : trend === "down" ? "destructive" : "secondary"}>
            {trend === "up" ? "↑" : trend === "down" ? "↓" : "—"}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
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

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-6">Loading...</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Chain Pulse</h1>
          <p className="text-muted-foreground mt-2">
            Robinhood Chain · Chain ID 4663 · Last indexed: {data?.lastUpdatedAt || "N/A"}
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <MetricCard title="Net Capital Inflow 24h" value={`$${(data?.netCapitalInflow24h || 0).toLocaleString()}`} trend="up" />
          <MetricCard title="Active Wallets 24h" value={(data?.activeWallets24h || 0).toLocaleString()} />
          <MetricCard title="DEX Economic Volume 24h" value={`$${(data?.dexVolume24h || 0).toLocaleString()}`} />
          <MetricCard title="USDG Net Flow 24h" value={`$${(data?.usdgNetFlow24h || 0).toLocaleString()}`} />
          <MetricCard title="Signals 24h" value={(data?.signals24h || 0).toString()} />
          <MetricCard title="High Risk Alerts" value={(data?.highRiskAlerts || 0).toString()} trend={data?.highRiskAlerts ? "down" : "neutral"} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Capital Flow Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                Chart placeholder — Data loading from DB
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity Composition</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                Chart placeholder — Data loading from DB
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Signal / Anomaly Feed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground">
              Recent signals and anomalies will appear here
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
