import type { Metadata } from "next";
import MemeLeadersExplorer from "./explorer";
import "./explorer.css";

export const metadata: Metadata = {
  title: "Meme Leaders",
  description: "Explore observed trending token candidates on Robinhood Chain. Compare source-tagged memes, representative pool activity, liquidity and source context.",
  alternates: { canonical: "/meme-leaders" },
};

export default function MemeLeadersPage() {
  return <MemeLeadersExplorer />;
}
