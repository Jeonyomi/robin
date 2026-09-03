"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { useWatchlist } from "@/lib/hooks/use-watchlist";

type WatchedToken = {
  address: string;
  symbol: string | null;
  name: string | null;
  canonicalStatus: string;
};

function formatAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function WatchlistPage() {
  const { watchlist, remove } = useWatchlist();
  const [tokens, setTokens] = useState<WatchedToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setMounted(true));
  }, []);

  useEffect(() => {
    if (!mounted || watchlist.length === 0) {
      return;
    }
    Promise.all(
      watchlist.map(async (address) => {
        try {
          const res = await fetch(`/api/v1/tokens/${address}`);
          const json = await res.json();
          const t = json.data;
          return t
            ? { address: t.address, symbol: t.symbol, name: t.name, canonicalStatus: t.canonicalStatus }
            : null;
        } catch {
          return null;
        }
      })
    ).then((results) => {
      setTokens(results.filter((t): t is WatchedToken => t !== null));
      setLoading(false);
    });
  }, [watchlist, mounted]);

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Watchlist</h1>
          <p className="text-muted-foreground mt-1">
            Tokens you are tracking — stored locally in your browser
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Watched Tokens ({watchlist.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && watchlist.length > 0 ? (
              <p className="text-muted-foreground py-8 text-center">Loading watchlist...</p>
            ) : tokens.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground mb-2">Your watchlist is empty</p>
                <p className="text-sm text-muted-foreground">
                  Open any token detail page and click{" "}
                  <span className="text-yellow-500">☆ Watch</span> to track it here.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {tokens.map((token) => (
                  <div key={token.address} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30">
                    <div>
                      <Link href={`/tokens/${token.address}`} className="hover:underline">
                        <span className="font-medium">{token.symbol || "?"}</span>
                        <span className="text-muted-foreground ml-2 text-xs font-mono">{formatAddress(token.address)}</span>
                      </Link>
                      <p className="text-xs text-muted-foreground mt-0.5">{token.name}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {token.canonicalStatus === "CANONICAL" && (
                        <Badge className="bg-green-600 text-xs">✓ Canonical</Badge>
                      )}
                      <button
                        onClick={() => remove(token.address)}
                        className="text-xs text-muted-foreground hover:text-red-500 transition-colors"
                      >
                        Remove
                      </button>
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
