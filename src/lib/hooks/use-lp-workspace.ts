"use client";

import { useSyncExternalStore } from "react";
import type { PositionInput } from "@/lib/domain/lp";
import { LP_STORAGE_KEY, parseWorkspace, serializeWorkspace } from "@/lib/lp-workspace";

type Snapshot = { ready: boolean; positions: PositionInput[]; revision: string | null; error: string | null };
const serverSnapshot: Snapshot = { ready: false, positions: [], revision: null, error: null };
let snapshot = serverSnapshot;
const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}
function load() {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LP_STORAGE_KEY);
    const positions = raw == null ? [] : parseWorkspace(raw).positions;
    publish({ ready: true, positions, revision: raw, error: null });
  } catch {
    publish({ ready: true, positions: [], revision: raw, error: "Saved workspace is unreadable or browser storage is blocked. Nothing was overwritten. Export a backup before resetting." });
  }
}
function onStorage(event: StorageEvent) {
  if (event.key == null || event.key === LP_STORAGE_KEY) load();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("storage", onStorage);
    load();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}

export function useLpWorkspace() {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => serverSnapshot);
  async function exclusiveWrite(action: () => void) {
    if (!navigator.locks) throw new Error("This browser cannot safely coordinate local writes. Use a browser with Web Locks support.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      await navigator.locks.request(`${LP_STORAGE_KEY}:write`, { mode: "exclusive", signal: controller.signal }, action);
    } finally { clearTimeout(timer); }
  }
  async function save(positions: PositionInput[]) {
    if (!state.ready || state.error) throw new Error("Resolve browser storage before saving.");
    const raw = serializeWorkspace(positions);
    await exclusiveWrite(() => {
      // Revision check AND write are serialized across tabs; localStorage alone
      // does not provide compare-and-set atomicity.
      if (window.localStorage.getItem(LP_STORAGE_KEY) !== state.revision) {
        load();
        throw new Error("Workspace changed in another tab. Review the latest version before saving again.");
      }
      window.localStorage.setItem(LP_STORAGE_KEY, raw);
      publish({ ready: true, positions: parseWorkspace(raw).positions, revision: raw, error: null });
    });
  }
  async function reset() {
    await exclusiveWrite(() => {
      if (window.localStorage.getItem(LP_STORAGE_KEY) !== state.revision) {
        load();
        throw new Error("Workspace changed in another tab. Review it before resetting.");
      }
      window.localStorage.removeItem(LP_STORAGE_KEY);
      load();
    });
  }
  return { ...state, save, reset };
}
