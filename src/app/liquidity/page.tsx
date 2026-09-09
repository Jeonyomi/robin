import type { Metadata } from "next";
import StockPairs from "./stock-pairs";
import "./stock-pairs.css";

export const metadata: Metadata = {
  title: "Meme & Stock Pairs",
  description: "Discover candidate meme and stock-token pairs, then inspect observed onchain pool state and related liquidity positions.",
  alternates: { canonical: "/liquidity" },
};

export default function LiquidityPage() {
  return <StockPairs />;
}
