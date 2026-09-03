"use client";

import dynamic from "next/dynamic";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

export type ActivityCompositionItem = {
  name: string;
  value: number;
};

const COLORS = ["#3b82f6", "#22c55e", "#f97316", "#8b5cf6", "#eab308", "#ec4899", "#06b6d4", "#64748b"];

export function ActivityCompositionChart({ data }: { data: ActivityCompositionItem[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
        Data unavailable — activity composition will appear after on-chain sync
      </div>
    );
  }

  const option = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item",
      formatter: "{b}: ${c} ({d}%)",
    },
    legend: {
      orient: "vertical",
      right: 10,
      top: "center",
      textStyle: { color: "#888" },
    },
    series: [
      {
        name: "Activity",
        type: "pie",
        radius: ["40%", "70%"],
        center: ["40%", "50%"],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 4, borderColor: "#0a0a0a", borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 12, fontWeight: "bold", color: "#ccc" } },
        data: data.map((d, i) => ({ ...d, itemStyle: { color: COLORS[i % COLORS.length] } })),
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: "16rem" }} notMerge />;
}
