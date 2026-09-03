"use client";

import dynamic from "next/dynamic";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

export type FlowTimelinePoint = {
  timestamp: string;
  bridgeIn: number;
  bridgeOut: number;
  dexBuy: number;
  dexSell: number;
};

export function FlowTimelineChart({ data }: { data: FlowTimelinePoint[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
        Data unavailable — bridge and DEX events will populate after on-chain sync
      </div>
    );
  }

  const option = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      valueFormatter: (v: number) => `$${v.toLocaleString()}`,
    },
    legend: {
      data: ["Bridge In", "Bridge Out", "DEX Buy", "DEX Sell"],
      textStyle: { color: "#888" },
      top: 0,
    },
    grid: { left: 60, right: 20, top: 40, bottom: 30 },
    xAxis: {
      type: "category",
      data: data.map((d) => new Date(d.timestamp).toLocaleTimeString()),
      axisLabel: { color: "#888", fontSize: 10 },
      axisLine: { lineStyle: { color: "#333" } },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: "#888",
        fontSize: 10,
        formatter: (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${(v / 1_000).toFixed(0)}K`),
      },
      splitLine: { lineStyle: { color: "#222" } },
    },
    series: [
      { name: "Bridge In", type: "bar", stack: "total", data: data.map((d) => d.bridgeIn), itemStyle: { color: "#22c55e" } },
      { name: "Bridge Out", type: "bar", stack: "total", data: data.map((d) => d.bridgeOut), itemStyle: { color: "#ef4444" } },
      { name: "DEX Buy", type: "bar", stack: "total", data: data.map((d) => d.dexBuy), itemStyle: { color: "#3b82f6" } },
      { name: "DEX Sell", type: "bar", stack: "total", data: data.map((d) => d.dexSell), itemStyle: { color: "#f97316" } },
    ],
  };

  return <ReactECharts option={option} style={{ height: "16rem" }} notMerge />;
}
