import { setTimeout as wait } from "node:timers/promises";
import { LpUnavailableError } from "./availability";

export function sourceRetryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 60;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - now) / 1000);
  return Number.isSafeInteger(seconds) && seconds > 0 ? Math.max(60, seconds) : 60;
}

/** JSON-RPC batches are forbidden. A queue wait must not consume the network timeout. */
export function createPacedLpFetch(signal: AbortSignal, options: { fetch?: typeof fetch; intervalMs?: number; logIntervalMs?: number; networkTimeoutMs?: number; now?: () => number } = {}): typeof fetch {
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const interval = options.intervalMs ?? 650;
  const timeout = options.networkTimeoutMs ?? 10_000;
  const stopped = new AbortController();
  const collectionSignal = AbortSignal.any([signal, stopped.signal]);
  let nextAt = 0; let nextLogAt = 0; let requests = 0; let rateError: LpUnavailableError | undefined;
  const paced: typeof fetch = async (url, init) => {
    if (rateError) throw rateError;
    collectionSignal.throwIfAborted();
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (Array.isArray(body) || ++requests > 180) throw new Error("LP source request budget exceeded.");
    const isLog = body.method === "eth_getLogs";
    const slot = Math.max(now(), nextAt, isLog ? nextLogAt : 0);
    const delay = Math.max(0, slot - now());
    nextAt = slot + interval;
    if (isLog) nextLogAt = slot + (options.logIntervalMs ?? 1500);
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
        const known = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_getLogs", "eth_getTransactionReceipt"]);
        console.warn("LP_RPC_RATE_LIMIT", JSON.stringify({ method: known.has(body.method) ? body.method : "other" }));
        rateError = new LpUnavailableError(true, sourceRetryAfter(response.headers.get("Retry-After"), now()));
        stopped.abort(rateError); // Cancel queued and in-flight reads, not just the failing call.
        throw rateError;
      }
      return new Response(bytes, { status: response.status, headers: { "Content-Type": "application/json" } });
    } catch (error) { throw rateError ?? error; }
    finally { clearTimeout(timer); }
  };
  // Expensive history queries must not overlap, even when their network latency
  // exceeds the global start-spacing interval. Never parallelize eth_getLogs.
  let logTail: Promise<void> = Promise.resolve();
  return (url, init) => {
    let isLog = false;
    try { isLog = JSON.parse(String(init?.body ?? "{}"))?.method === "eth_getLogs"; } catch { /* paced rejects malformed requests. */ }
    if (!isLog) return paced(url, init);
    const request = logTail.then(() => paced(url, init));
    logTail = request.then(() => undefined, () => undefined);
    return request;
  };
}
