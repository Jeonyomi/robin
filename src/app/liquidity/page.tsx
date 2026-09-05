import type { Metadata } from "next";
import LpWorkspace from "./workspace";
import "./workspace.css";

export const metadata: Metadata = {
  title: "LP Workspace",
  description: "Read-only Uniswap v3 position state and separate browser-local concentrated-liquidity scenarios. No wallet connection or trade execution.",
  alternates: { canonical: "/liquidity" },
};

export default function LiquidityPage() {
  return <LpWorkspace />;
}
