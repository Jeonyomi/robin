"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type SourceHealth = {
  name: string;
  url: string;
  status: string;
  lastSuccessAt: string | null;
  lastError: string | null;
};

function SourceStatusBadge({ status }: { status: string }) {
  if (status === "healthy") {
    return <Badge className="bg-green-600">Healthy</Badge>;
  }
  if (status === "degraded") {
    return <Badge className="bg-yellow-600">Degraded</Badge>;
  }
  if (status === "unavailable") {
    return <Badge variant="destructive">Unavailable</Badge>;
  }
  return <Badge variant="secondary">Unknown</Badge>;
}

export default function DataSourcesPage() {
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/source-health")
      .then((res) => res.json())
      .then((json) => {
        setSources(json.data?.sources || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-6">Data Sources</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Data Sources</h1>
          <p className="text-muted-foreground mt-2">
            Source health and synchronization status
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Source Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {sources.map((source) => (
                <div key={source.name} className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <h3 className="font-medium">{source.name}</h3>
                    <p className="text-sm text-muted-foreground">{source.url}</p>
                    {source.lastSuccessAt && (
                      <p className="text-xs text-muted-foreground">
                        Last success: {new Date(source.lastSuccessAt).toLocaleString()}
                      </p>
                    )}
                    {source.lastError && (
                      <p className="text-xs text-destructive">
                        Error: {source.lastError}
                      </p>
                    )}
                  </div>
                  <SourceStatusBadge status={source.status} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
