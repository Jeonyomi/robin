import { setTimeout as wait } from "node:timers/promises";
import { LpUnavailableError } from "./availability";

export function sourceRetryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 60;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - now) / 1000);
  return Number.isSafeInteger(seconds) && seconds > 0 ? Math.max(60, seconds) : 60;
}

/** JSON-RPC batches are forbidden. A queue wait must not consume the network timeout. */
export function createPacedLpFetch(signal: AbortSignal, options: { fetch?: typeof fetch; intervalMs?: number; networkTimeoutMs?: number; now?: () => number } = {}): typeof fetch {
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const interval = options.intervalMs ?? 650;
  const timeout = options.networkTimeoutMs ?? 10_000;
  const stopped = new AbortController();
  const collectionSignal = AbortSignal.any([signal, stopped.signal]);
  let nextAt = 0; let requests = 0; let rateError: LpUnavailableError | undefined;
  return async (url, init) => {
    if (rateError) throw rateError;
    collectionSignal.throwIfAborted();
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (Array.isArray(body) || ++requests > 180) throw new Error("LP source request budget exceeded.");
    const delay = Math.max(0, nextAt - now());
    nextAt = Math.max(now(), nextAt) + interval;
    try { if (delay) await wait(delay, undefined, { signal: collectionSignal }); }
    catch (error) { throw rateError ?? error; }
    if (rateError) throw rateError;
    collectionSignal.throwIfAborted();
    const network = new AbortController();
    const timer = setTimeout(() => network.abort(), timeout);
    try {
      const response = await send(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.any([collectionSignal, network.signal, ...(init?.signal ? [init.signal] : [])]) });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      if (reader) while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 2_000_000) { await reader.cancel(); throw new Error("LP source response exceeded its safe limit."); }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let limited = response.status === 429;
      try { const payload: unknown = JSON.parse(new TextDecoder().decode(bytes)); limited ||= !!payload && typeof payload === "object" && "error" in payload && !!payload.error && typeof payload.error === "object" && "code" in payload.error && payload.error.code === 429; } catch { /* viem rejects malformed JSON; no fabricated response. */ }
      if (limited) {
        rateError = new LpUnavailableError(true, sourceRetryAfter(response.headers.get("Retry-After"), now()));
        stopped.abort(rateError); // Cancel queued and in-flight reads, not just the failing call.
        throw rateError;
      }
      return new Response(bytes, { status: response.status, headers: { "Content-Type": "application/json" } });
    } catch (error) { throw rateError ?? error; }
    finally { clearTimeout(timer); }
  };
}
