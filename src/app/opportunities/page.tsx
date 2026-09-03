"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function OpportunitiesPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Opportunity Radar</h1>
          <p className="text-muted-foreground mt-2">
            Risk-adjusted opportunity leaderboard
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Opportunities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground">
              Opportunity scoring will be implemented in Milestone 3
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
