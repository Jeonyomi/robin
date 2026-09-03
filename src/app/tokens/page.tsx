"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type TokenItem = {
  address: string;
  symbol: string | null;
  name: string | null;
  tokenType: string | null;
  isVerified: boolean | null;
  holderCount: number | null;
  holderDelta: number | null;
  uniqueBuyers: number | null;
  volumeUsd: string | null;
  liquidityUsd: string | null;
  top10Share: string | null;
  canonicalStatus: string;
  opportunityScore: number | null;
  riskScore: number | null;
  createdAt: string | null;
};

function formatAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatUsd(value: string | number | null) {
  if (value === null) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

function VerificationBadge({ verified }: { verified: boolean | null }) {
  if (verified === true) return <Badge className="bg-green-600 text-xs">✓ Verified</Badge>;
  if (verified === false) return <Badge variant="destructive" className="text-xs">Unverified</Badge>;
  return <Badge variant="secondary" className="text-xs">Unknown</Badge>;
}

export default function TokensPage() {
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"holders" | "volume" | "risk">("holders");

  useEffect(() => {
    fetch(`/api/v1/tokens?sort=${sort}`)
      .then((res) => res.json())
      .then((json) => {
        setTokens(json.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [sort]);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Token Scanner</h1>
          <p className="text-muted-foreground mt-2">
            New token discovery + liquidity + holder quality + contract risk
          </p>
        </header>

        {/* Sort controls */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex gap-2">
              {(["holders", "volume", "risk"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSort(s)}
                  className={`px-3 py-1.5 rounded-md text-sm ${
                    sort === s ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
                  }`}
                >
                  Sort by {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Token Table */}
        <Card>
          <CardHeader>
            <CardTitle>Discovered Tokens ({tokens.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground py-8 text-center">Scanning for tokens...</p>
            ) : tokens.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground mb-2">No tokens discovered yet</p>
                <p className="text-sm text-muted-foreground">
                  Tokens will appear after Blockscout sync and contract verification.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="p-2">Token</th>
                      <th className="p-2">Type</th>
                      <th className="p-2 text-center">Status</th>
                      <th className="p-2 text-right">Holders</th>
                      <th className="p-2 text-right">Buyers</th>
                      <th className="p-2 text-right">Volume</th>
                      <th className="p-2 text-right">Liquidity</th>
                      <th className="p-2 text-right">Top 10</th>
                      <th className="p-2 text-center">Risk</th>
                      <th className="p-2 text-center">Opp.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((token) => (
                      <tr key={token.address} className="border-b hover:bg-muted/50">
                        <td className="p-2">
                          <a href={`/tokens/${token.address}`} className="hover:underline">
                            <span className="font-medium">{token.symbol || "?"}</span>
                            <span className="text-muted-foreground ml-2 text-xs">{formatAddress(token.address)}</span>
                          </a>
                        </td>
                        <td className="p-2">
                          <Badge variant="outline" className="text-xs">{token.tokenType || "ERC-20"}</Badge>
                        </td>
                        <td className="p-2 text-center">
                          <VerificationBadge verified={token.isVerified} />
                        </td>
                        <td className="p-2 text-right">{token.holderCount?.toLocaleString() || "—"}</td>
                        <td className="p-2 text-right">{token.uniqueBuyers?.toLocaleString() || "—"}</td>
                        <td className="p-2 text-right">{formatUsd(token.volumeUsd)}</td>
                        <td className="p-2 text-right">{formatUsd(token.liquidityUsd)}</td>
                        <td className="p-2 text-right">{token.top10Share ? `${(parseFloat(token.top10Share) * 100).toFixed(0)}%` : "—"}</td>
                        <td className="p-2 text-center">
                          {token.riskScore !== null ? (
                            <Badge variant={token.riskScore >= 60 ? "destructive" : "secondary"}>
                              {token.riskScore}
                            </Badge>
                          ) : "—"}
                        </td>
                        <td className="p-2 text-center">
                          {token.opportunityScore !== null ? (
                            <Badge className={token.opportunityScore >= 70 ? "bg-green-600" : ""}>
                              {token.opportunityScore}
                            </Badge>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
