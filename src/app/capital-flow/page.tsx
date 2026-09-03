"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CapitalFlowPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Capital Flow</h1>
          <p className="text-muted-foreground mt-2">
            Bridge → Stablecoin → DEX → Protocol flow analysis
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Flow Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground">
              Capital flow tracking will be implemented in Milestone 5
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
