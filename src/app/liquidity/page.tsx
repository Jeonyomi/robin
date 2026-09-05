import type { Metadata } from "next";
import LpExplorer from "./explorer";
import "./explorer.css";

export const metadata: Metadata = {
  title: "LP Leaders",
  description: "Discover sampled Uniswap v3 LP NFTs ranked by lifetime fee income marked in WETH. Compare observed range structures and risks, not predicted returns.",
  alternates: { canonical: "/liquidity" },
};

export default function LiquidityPage() {
  return <LpExplorer />;
}
