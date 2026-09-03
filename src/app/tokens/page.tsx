"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TokensPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Token Scanner</h1>
          <p className="text-muted-foreground mt-2">
            New token discovery + liquidity + holder quality + contract risk
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Token Discovery</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground">
              Token scanner will be implemented in Milestone 4
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
