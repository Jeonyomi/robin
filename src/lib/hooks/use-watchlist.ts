"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "robin-watchlist";

// ── Watchlist (localStorage-based, anonymous — master prompt §16.8) ─────────

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState<string[]>([]);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setWatchlist(parsed);
        }
      } catch {
        // Corrupted storage — start fresh
      }
    });
  }, []);

  const persist = useCallback((list: string[]) => {
    setWatchlist(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Storage unavailable (private mode) — keep in-memory
    }
  }, []);

  const add = useCallback((address: string) => {
    const normalized = address.toLowerCase();
    setWatchlist((prev) => {
      const next = prev.includes(normalized) ? prev : [...prev, normalized];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const remove = useCallback((address: string) => {
    const normalized = address.toLowerCase();
    setWatchlist((prev) => {
      const next = prev.filter((a) => a !== normalized);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const toggle = useCallback(
    (address: string) => {
      const normalized = address.toLowerCase();
      if (watchlist.includes(normalized)) remove(normalized);
      else add(normalized);
    },
    [watchlist, add, remove]
  );

  const isWatched = useCallback(
    (address: string) => watchlist.includes(address.toLowerCase()),
    [watchlist]
  );

  return { watchlist, add, remove, toggle, isWatched, persist };
}
