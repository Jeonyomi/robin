"use client";

import dynamic from "next/dynamic";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const chartDateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export type ActivityTimelinePoint = {
  timestamp: string;
  transfers: number;
  activeAddresses: number;
  mints: number;
  burns: number;
};

export function ActivityTimelineChart({ data }: { data: ActivityTimelinePoint[] }) {
  if (!data?.length) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-6 text-center text-sm text-muted-foreground">
        No transfer observations in this window yet. The rotating indexer will populate this view.
      </div>
    );
  }

  const option = {
    animationDuration: 350,
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "#101713",
      borderWidth: 0,
      textStyle: { color: "#f7faf8", fontSize: 12 },
    },
    legend: {
      data: ["Transfers", "Active addresses"],
      right: 0,
      top: 0,
      textStyle: { color: "#6b746e", fontSize: 11 },
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 4,
    },
    grid: { left: 46, right: 44, top: 42, bottom: 32 },
    xAxis: {
      type: "category",
      boundaryGap: true,
      data: data.map((point) => chartDateTime.format(new Date(point.timestamp))),
      axisLabel: { color: "#88918b", fontSize: 10, hideOverlap: true },
      axisLine: { lineStyle: { color: "#dfe5e1" } },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: "value",
        minInterval: 1,
        axisLabel: { color: "#88918b", fontSize: 10 },
        splitLine: { lineStyle: { color: "#edf1ee" } },
      },
      {
        type: "value",
        minInterval: 1,
        axisLabel: { color: "#88918b", fontSize: 10 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "Transfers",
        type: "bar",
        data: data.map((point) => point.transfers),
        itemStyle: { color: "#17231c", borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 22,
      },
      {
        name: "Active addresses",
        type: "line",
        yAxisIndex: 1,
        data: data.map((point) => point.activeAddresses),
        smooth: 0.28,
        symbol: "none",
        lineStyle: { color: "#36c978", width: 2 },
        areaStyle: { color: "rgba(54, 201, 120, 0.09)" },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: "18rem" }} notMerge />;
}
