"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type AlertSignal = {
  id: string;
  type: string;
  entityType: string;
  entityId: string;
  rawScore: number;
  riskScore: number;
  adjustedScore: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  window: string;
  createdAt: string;
  status: string;
  evidence: Array<{ metric: string; value: number }>;
  riskFlags: string[];
};

function formatAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function SignalTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    SMART_ACCUMULATION: "bg-green-600",
    CAPITAL_ROTATION: "bg-blue-600",
    NEW_TOKEN_BREAKOUT: "bg-purple-600",
    STOCK_TOKEN_DIVERGENCE: "bg-yellow-600",
    FAKE_MOMENTUM_WARNING: "bg-red-600",
    TICKER_COLLISION: "bg-red-700",
    LIQUIDITY_REMOVAL: "bg-orange-600",
    CONTRACT_RISK_CHANGE: "bg-orange-700",
  };
  return (
    <Badge className={`${map[type] || "bg-gray-600"} text-xs`}>
      {type.replace(/_/g, " ")}
    </Badge>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  if (confidence === "HIGH") return <Badge className="bg-green-600 text-xs">High</Badge>;
  if (confidence === "MEDIUM") return <Badge className="bg-yellow-600 text-xs">Medium</Badge>;
  return <Badge variant="secondary" className="text-xs">Low</Badge>;
}

export default function AlertsPage() {
  const [signals, setSignals] = useState<AlertSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("type", filter);

    fetch(`/api/v1/signals?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        setSignals(json.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [filter]);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Alerts</h1>
          <p className="text-muted-foreground mt-2">
            Signal feed and risk alerts
          </p>
        </header>

        {/* Filter */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {["all", "SMART_ACCUMULATION", "CAPITAL_ROTATION", "NEW_TOKEN_BREAKOUT", "STOCK_TOKEN_DIVERGENCE", "FAKE_MOMENTUM_WARNING"].map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-3 py-1.5 rounded-md text-xs ${
                filter === t ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
              }`}
            >
              {t === "all" ? "All Signals" : t.replace(/_/g, " ")}
            </button>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Signal Feed ({signals.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground py-8 text-center">Loading signals...</p>
            ) : signals.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground mb-2">No signals generated yet</p>
                <p className="text-sm text-muted-foreground">
                  Signals will appear after on-chain data ingestion and metric calculation.
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Signal types: SMART_ACCUMULATION, CAPITAL_ROTATION, NEW_TOKEN_BREAKOUT,
                  STOCK_TOKEN_DIVERGENCE, FAKE_MOMENTUM_WARNING, TICKER_COLLISION
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {signals.map((signal) => (
                  <div key={signal.id} className="p-4 border rounded-lg hover:bg-muted/30">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <SignalTypeBadge type={signal.type} />
                          <ConfidenceBadge confidence={signal.confidence} />
                          <Badge variant="outline" className="text-xs">{signal.window}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {signal.entityType}: <span className="font-mono">{formatAddress(signal.entityId)}</span>
                        </p>
                        <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                          <span>Opp: {signal.rawScore.toFixed(1)}</span>
                          <span>Risk: {signal.riskScore.toFixed(1)}</span>
                          <span>Adjusted: {signal.adjustedScore.toFixed(1)}</span>
                        </div>
                        {signal.riskFlags.length > 0 && (
                          <div className="flex gap-1 mt-2">
                            {signal.riskFlags.map((flag) => (
                              <Badge key={flag} variant="destructive" className="text-xs">{flag}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(signal.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
