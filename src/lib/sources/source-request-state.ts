import { mkdir, open, readFile, rename, unlink, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type ProviderState = { day: string; calls: number; nextStart: number; cooldownUntil: number; scopes: Record<string, number> };
export type SourceState = { version: 1; providers: Record<string, ProviderState> };
export interface SourceStateStore { update<T>(change: (state: SourceState) => T): Promise<T> }
export function createMemorySourceState(): SourceStateStore {
  const state: SourceState = { version: 1, providers: {} };
  return { async update<T>(change: (state: SourceState) => T) { return change(state); } };
}
const fail = () => new Error("Source quota state unavailable.");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function validate(value: unknown): asserts value is SourceState {
  if (!object(value) || value.version !== 1 || Object.keys(value).sort().join() !== "providers,version" || !object(value.providers)) throw fail();
  for (const [source, p] of Object.entries(value.providers)) {
    if (!["blockscout", "robinhood", "dexscreener", "geckoterminal"].includes(source) || !object(p)
      || Object.keys(p).sort().join() !== "calls,cooldownUntil,day,nextStart,scopes"
      || typeof p.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.day) || !Number.isFinite(Date.parse(p.day))
      || !integer(p.calls) || !integer(p.nextStart) || !integer(p.cooldownUntil) || !object(p.scopes)
      || Object.keys(p.scopes).length > 128 || Object.entries(p.scopes).some(([key, until]) => !/^[a-f0-9]{64}$/.test(key) || !integer(until))) throw fail();
  }
}
const errorCode = (error: unknown) => object(error) ? error.code : undefined;

// Exclusive lock + read/modify/atomic replacement covers independent CLI processes.
// Never steal a stale lock: a crashed writer leaves a fail-closed operator action.
export function createFileSourceState(file: string, lockWaitMs = 1000): SourceStateStore {
  return {
    async update<T>(change: (state: SourceState) => T): Promise<T> {
      const lock = `${file}.lock`;
      const temp = `${file}.${randomUUID()}.tmp`;
      let handle: Awaited<ReturnType<typeof open>>;
      try {
        await mkdir(dirname(file), { recursive: true });
        const deadline = Date.now() + Math.max(0, Math.min(1000, lockWaitMs));
        while (true) {
          try { handle = await open(lock, "wx", 0o600); break; }
          catch (error) {
            if (errorCode(error) !== "EEXIST" || Date.now() >= deadline) throw fail();
            await new Promise(resolve => setTimeout(resolve, 25));
          }
        }
      } catch { throw fail(); }
      try {
        let state: SourceState;
        try {
          if ((await stat(file)).size > 65_536) throw fail();
          const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
          validate(parsed); state = parsed;
        } catch (error) {
          if (errorCode(error) === "ENOENT") state = { version: 1, providers: {} };
          else throw fail();
        }
        const result = change(state);
        try {
          validate(state);
          const writer = await open(temp, "wx", 0o600);
          try { await writer.writeFile(JSON.stringify(state)); await writer.sync(); }
          finally { await writer.close(); }
          await rename(temp, file);
        } catch { throw fail(); }
        return result;
      } finally {
        await handle.close();
        await unlink(lock);
        await unlink(temp).catch(() => {});
      }
    },
  };
}

// Serverless is explicitly INSTANCE-LOCAL, not a cross-instance quota guarantee (P1).
// Resolve the collector flag lazily: launchers can opt in after module imports.
export function createDefaultSourceState(): SourceStateStore {
  const memory = createMemorySourceState();
  return { update<T>(change: (state: SourceState) => T) {
    const store = process.env.ROBINWATCH_COLLECTOR === "1"
      ? createFileSourceState(process.env.ROBINWATCH_SOURCE_STATE_PATH || join(process.cwd(), "data", "source-request-state.json"))
      : memory;
    return store.update(change);
  } };
}
