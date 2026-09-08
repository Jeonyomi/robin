type ReadOptions<T> = { cost: number; accept?: (value: T) => boolean; cacheMs?: number };

export class PublicRpcBusyError extends Error {
  constructor(readonly retryAfterSeconds = 30) { super("Public RPC budget is cooling down. Retry later."); }
}

/** Process-local shared gate, NOT a provider-wide or distributed quota promise. */
export function createPublicRpcGate(now: () => number = () => Date.now()) {
  let nextReadAt = 0;
  let budgetDay = -1;
  let dailyCost = 0;
  let starts: { at: number; cost: number }[] = [];
  const pending = new Map<string, Promise<unknown>>();
  const cache = new Map<string, { value: unknown; until: number }>();
  return {
    async run<T>(key: string, load: () => Promise<T>, options: ReadOptions<T>): Promise<T> {
      const current = now();
      for (const [id, item] of cache) if (item.until <= current) cache.delete(id);
      const cached = cache.get(key);
      if (cached && (!options.accept || options.accept(cached.value as T))) return cached.value as T;
      cache.delete(key);
      const running = pending.get(key);
      if (running) return running as Promise<T>;
      if (!Number.isSafeInteger(options.cost) || options.cost < 1 || options.cost > 192) throw new PublicRpcBusyError();
      const day = Math.floor(current / 86_400_000);
      if (day > budgetDay) { budgetDay = day; dailyCost = 0; }
      if (day < budgetDay || dailyCost + options.cost > 10_000) {
        throw new PublicRpcBusyError(Math.max(1, Math.ceil(((budgetDay + 1) * 86_400_000 - current) / 1000)));
      }
      starts = starts.filter((item) => current - item.at < 60_000);
      if (pending.size || current < nextReadAt || starts.length >= 6
        || starts.reduce((sum, item) => sum + item.cost, 0) + options.cost > 192) {
        throw new PublicRpcBusyError(Math.max(1, Math.ceil((Math.max(nextReadAt, (starts[0]?.at ?? current) + 60_000) - current) / 1000)));
      }
      starts.push({ at: current, cost: options.cost });
      dailyCost += options.cost;
      const request = Promise.resolve().then(load).then((value) => {
        if (options.accept && !options.accept(value)) throw new Error("Public RPC observation is unavailable.");
        if (cache.size >= 64) cache.delete(cache.keys().next().value!);
        cache.set(key, { value, until: now() + Math.min(30_000, options.cacheMs ?? 30_000) });
        return value;
      }).catch((error: unknown) => {
        nextReadAt = Math.max(nextReadAt, now() + 30_000);
        throw error;
      }).finally(() => { pending.delete(key); nextReadAt = Math.max(nextReadAt, now() + 2_000); });
      pending.set(key, request);
      return request;
    },
  };
}

export const publicRpcGate = createPublicRpcGate();
