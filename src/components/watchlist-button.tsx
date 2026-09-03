"use client";

import { useEffect, useState } from "react";
import { useWatchlist } from "@/lib/hooks/use-watchlist";

export function WatchlistButton({ address }: { address: string }) {
  const { isWatched, toggle } = useWatchlist();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setMounted(true));
  }, []);

  const watched = mounted && isWatched(address);

  return (
    <button
      onClick={() => toggle(address)}
      className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
        watched
          ? "bg-yellow-600/20 border-yellow-600/50 text-yellow-500 hover:bg-yellow-600/30"
          : "border-border text-muted-foreground hover:border-yellow-600/50 hover:text-yellow-500"
      }`}
      title={watched ? "Remove from watchlist" : "Add to watchlist"}
      aria-pressed={watched}
    >
      {watched ? "★ Watched" : "☆ Watch"}
    </button>
  );
}
