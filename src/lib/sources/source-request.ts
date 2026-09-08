import { createHash } from "node:crypto";
import { createDefaultSourceState, type SourceStateStore } from "./source-request-state";
export { createMemorySourceState } from "./source-request-state";

export type Source = "blockscout" | "robinhood" | "dexscreener" | "geckoterminal";
export type SourceRequestCode = "http" | "network" | "timeout" | "aborted" | "response-too-large" | "invalid-json" | "schema" | "cooldown" | "budget" | "state" | "wait-budget" | "challenge";
export class SourceRequestError extends Error {
  readonly code: SourceRequestCode;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  constructor(code: SourceRequestCode, status: number | null = null, retryAfterMs: number | null = null) {
    super(`Source request failed (${code}).`);
    this.name = "SourceRequestError";
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
export function isSourceBlocked(error: unknown): boolean {
  return error instanceof SourceRequestError && (error.status === 403 || error.status === 429 || ["cooldown", "budget", "state", "wait-budget", "challenge"].includes(error.code));
}
export type SourceRequestOptions = { headers?: Record<string, string>; scope?: string; timeoutMs?: number; maxBytes?: number; signal?: AbortSignal; allow404?: boolean };
type Dependencies = { fetch?: typeof fetch; now?: () => number; monotonicNow?: () => number; wait?: (ms: number) => Promise<void>; random?: () => number; state?: SourceStateStore; limits?: { processCalls?: number; dailyCalls?: number } };
const bounded = (value: number | undefined, fallback: number) => value !== undefined && Number.isFinite(value) ? Math.max(1, Math.min(fallback, value)) : fallback;

async function transport(fetcher: typeof fetch, url: string, options: SourceRequestOptions, now: () => number): Promise<unknown> {
  const controller = new AbortController();
  let status: number | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectAbort: (error: SourceRequestError) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => { controller.abort(); rejectAbort(new SourceRequestError("aborted", status)); };
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { controller.abort(); rejectAbort(new SourceRequestError("timeout", status)); }, bounded(options.timeoutMs, 20_000));
  try {
    if (options.signal?.aborted) throw new SourceRequestError("aborted");
    const response = await Promise.race([fetcher(url, { method: "GET", headers: { Accept: "application/json", ...options.headers }, redirect: "error", cache: "no-store", signal: controller.signal }), interrupted]);
    status = response.status;
    if (status === 404 && options.allow404) { void response.body?.cancel().catch(() => {}); return null; }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const retryAfter = response.headers.get("retry-after");
      const delay = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : retryAfter ? Date.parse(retryAfter) - now() : NaN;
      if (status === 429) throw new SourceRequestError("http", status, Number.isFinite(delay) ? Math.max(1000, Math.min(604_800_000, delay)) : 60_000);
      if (status === 403) throw new SourceRequestError("http", status, 900_000);
      if (response.headers.get("cf-mitigated") === "challenge" || /text\/html/i.test(response.headers.get("content-type") ?? "")) throw new SourceRequestError("challenge", status, 900_000);
      throw new SourceRequestError("http", status);
    }
    if (response.headers.get("cf-mitigated") === "challenge" || /text\/html/i.test(response.headers.get("content-type") ?? "")) {
      void response.body?.cancel().catch(() => {});
      throw new SourceRequestError("challenge", status, 900_000);
    }
    const maxBytes = bounded(options.maxBytes, 4_000_000);
    if (Number(response.headers.get("content-length")) > maxBytes) throw new SourceRequestError("response-too-large", status);
    reader = response.body?.getReader();
    if (!reader) throw new SourceRequestError("invalid-json", status);
    let bytes = 0;
    let text = "";
    const decoder = new TextDecoder();
    while (true) {
      const part = await Promise.race([reader.read(), interrupted]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) throw new SourceRequestError("response-too-large", status);
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new SourceRequestError("invalid-json", status); }
    // For optional endpoints null is reserved for allowed 404, never HTTP success.
    if (data === null && options.allow404) throw new SourceRequestError("schema", status);
    return data;
  } catch (error) {
    if (error instanceof SourceRequestError) throw error;
    throw new SourceRequestError(options.signal?.aborted ? "aborted" : "network", status);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}
// Local hard ceilings, not provider entitlement. Retries consume calls too.
export const SOURCE_LIMITS = {
  blockscout: { spacingMs: 1000, processCalls: 120, dailyCalls: 9000 },
  robinhood: { spacingMs: 500, processCalls: 30, dailyCalls: 1500 },
  dexscreener: { spacingMs: 500, processCalls: 30, dailyCalls: 1000 },
  geckoterminal: { spacingMs: 2100, processCalls: 30, dailyCalls: 500 },
} as const;
const MAX_WAIT_MS = 8000;
// Recent admission ceiling, not a lifetime quota for warm workers/watch loops.
const CALL_WINDOW_MS = 60_000;

// Bounds queue/backoff waits independently of the transport's network/body deadline.
function interruptible<T>(promise: Promise<T>, signal: AbortSignal | undefined, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(new SourceRequestError("aborted")); };
    const timer = setTimeout(() => { cleanup(); reject(new SourceRequestError("wait-budget")); }, Math.max(1, timeoutMs));
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
export function createSourceRequester(dependencies: Dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  // Existing virtual-clock fixtures may supply only now; production uses monotonic time.
  const monotonicNow = dependencies.monotonicNow ?? dependencies.now ?? (() => performance.now());
  const wait = dependencies.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const random = dependencies.random ?? Math.random;
  const state = dependencies.state ?? createDefaultSourceState();
  const tails = new Map<Source, Promise<void>>();
  const calls = new Map<Source, number[]>();
  async function update<T>(change: Parameters<SourceStateStore["update"]>[0]): Promise<T> {
    try { return await state.update(change) as T; }
    catch (error) { if (error instanceof SourceRequestError) throw error; throw new SourceRequestError("state"); }
  }
  return async (source: Source, url: string, options: SourceRequestOptions = {}): Promise<unknown> => {
    const previous = tails.get(source) ?? Promise.resolve();
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    // Hold order even when a queued caller cancels. Other providers are independent.
    const tail = previous.then(() => gate);
    tails.set(source, tail);
    const queuedAt = monotonicNow();
    let waited = 0;
    const checkWaitBudget = () => {
      if (waited >= MAX_WAIT_MS) throw new SourceRequestError("wait-budget");
    };
    const pause = async (ms: number) => {
      if (waited + ms > MAX_WAIT_MS) throw new SourceRequestError("wait-budget");
      const started = monotonicNow();
      await interruptible(wait(ms), options.signal, MAX_WAIT_MS - waited);
      waited += Math.max(0, monotonicNow() - started);
      checkWaitBudget();
    };
    const policy = SOURCE_LIMITS[source];
    const scope = createHash("sha256").update(options.scope ?? "default").digest("hex");
    try {
      await interruptible(previous, options.signal, MAX_WAIT_MS);
      waited = Math.max(0, monotonicNow() - queuedAt);
      for (let attempt = 0; attempt < 3; attempt++) {
        while (true) {
          if (options.signal?.aborted) throw new SourceRequestError("aborted");
          checkWaitBudget();
          const delay = await update<number>(state => {
            const time = now();
            const day = new Date(time).toISOString().slice(0, 10);
            const p = state.providers[source] ??= { day, calls: 0, nextStart: 0, cooldownUntil: 0, scopes: {} };
            if (p.day !== day) { p.day = day; p.calls = 0; }
            for (const [key, until] of Object.entries(p.scopes)) if (until <= time) delete p.scopes[key];
            const cooldown = Math.max(p.cooldownUntil, p.scopes[scope] ?? 0) - time;
            if (cooldown > 0) throw new SourceRequestError("cooldown", null, cooldown);
            const recent = (calls.get(source) ?? []).filter(start => start > time - CALL_WINDOW_MS);
            calls.set(source, recent);
            if (recent.length >= bounded(dependencies.limits?.processCalls, policy.processCalls) || p.calls >= bounded(dependencies.limits?.dailyCalls, policy.dailyCalls)) throw new SourceRequestError("budget");
            if (p.nextStart > time) return p.nextStart - time;
            p.calls++;
            p.nextStart = time + policy.spacingMs;
            return 0;
          });
          if (!delay) break;
          await pause(delay);
        }
        calls.get(source)!.push(now());
        try { return await transport(dependencies.fetch ?? globalThis.fetch, url, options, now); }
        catch (error) {
          if (!(error instanceof SourceRequestError)) throw new SourceRequestError("network");
          if (error.status === 429 || error.status === 403 || error.code === "challenge") {
            await update<void>(state => {
              const p = state.providers[source];
              const until = now() + (error.retryAfterMs ?? 900_000);
              if (error.status === 429) p.cooldownUntil = Math.max(p.cooldownUntil, until);
              else p.scopes[scope] = Math.max(p.scopes[scope] ?? 0, until);
            });
            throw error;
          }
          if (attempt === 2 || !(error.code === "network" || (error.code === "http" && error.status !== null && error.status >= 500))) throw error;
          await pause(500 * 2 ** attempt + Math.floor(random() * 250));
        }
      }
      throw new SourceRequestError("network");
    } finally {
      release();
      void tail.then(() => { if (tails.get(source) === tail) tails.delete(source); });
    }
  };
}
export const fetchSourceJson = createSourceRequester();
