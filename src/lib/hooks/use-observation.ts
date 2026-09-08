"use client";

import { useEffect, useState } from "react";

type Observation<T> = { key: string; data: T | null; loading: boolean; error: boolean };

// Keep select at module scope: identical request conditions must not refetch on render.
export function useObservation<T>(key: string, select: (payload: unknown) => T) {
  const [state, setState] = useState<Observation<T>>({ key, data: null, loading: true, error: false });
  // Reset before children render, not after paint: old data never belongs to a new condition.
  if (state.key !== key) {
    setState({ key, data: null, loading: true, error: false });
  }

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(key, { signal: controller.signal });
        if (!response.ok) throw new Error("Observation request failed");
        const payload: unknown = await response.json();
        if (controller.signal.aborted) return;
        const data = select(payload);
        setState((current) => current.key === key ? { key, data, loading: false, error: false } : current);
      } catch {
        if (controller.signal.aborted) return;
        setState((current) => current.key === key ? { key, data: null, loading: false, error: true } : current);
      }
    }
    void load();
    return () => controller.abort();
  }, [key, select]);

  return state.key === key ? state : { key, data: null, loading: true, error: false };
}
