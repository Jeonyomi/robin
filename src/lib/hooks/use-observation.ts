"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Observation<T> = { key: string; data: T | null; loading: boolean; error: boolean; receivedAt: number | null };
type ObservationOptions = { refreshOnReturnMs?: number };

// Keep select at module scope: identical request conditions must not refetch on render.
export function useObservation<T>(key: string, select: (payload: unknown) => T, options?: ObservationOptions) {
  const [state, setState] = useState<Observation<T>>({ key, data: null, loading: true, error: false, receivedAt: null });
  const request = useRef<((minimumAge?: number) => void) | null>(null);
  const refresh = useCallback(() => request.current?.(), []);
  // Reset before children render, not after paint: old data never belongs to a new condition.
  if (state.key !== key) {
    setState({ key, data: null, loading: true, error: false, receivedAt: null });
  }

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    // Includes failures and null successes: freshness must not depend on truthy data.
    let settledAt: number | null = null;
    async function load(minimumAge?: number) {
      if (!active || controller) return;
      if (minimumAge !== undefined && settledAt !== null && Date.now() - settledAt < minimumAge) return;
      const currentRequest = new AbortController();
      controller = currentRequest;
      setState((current) => current.key === key ? { ...current, loading: true, error: false } : current);
      try {
        const response = await fetch(key, { signal: currentRequest.signal });
        if (!response.ok) throw new Error("Observation request failed");
        const payload: unknown = await response.json();
        if (!active || currentRequest.signal.aborted) return;
        const data = select(payload);
        const receivedAt = Date.now();
        settledAt = receivedAt;
        setState((current) => current.key === key ? { key, data, loading: false, error: false, receivedAt } : current);
      } catch {
        if (!active || currentRequest.signal.aborted) return;
        // A slow failed request still gets a full return-event cooldown.
        settledAt = Date.now();
        setState((current) => current.key === key ? { ...current, loading: false, error: true } : current);
      } finally {
        controller = null;
      }
    }
    request.current = (minimumAge) => { void load(minimumAge); };
    void load();
    return () => {
      active = false;
      controller?.abort();
      request.current = null;
    };
  }, [key, select]);

  const refreshOnReturnMs = options?.refreshOnReturnMs;
  useEffect(() => {
    if (refreshOnReturnMs === undefined) return;
    function onReturn() {
      if (document.visibilityState === "visible") request.current?.(refreshOnReturnMs);
    }
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [refreshOnReturnMs]);

  return { ...(state.key === key ? state : { key, data: null, loading: true, error: false, receivedAt: null }), refresh };
}
