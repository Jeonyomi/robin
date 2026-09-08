import { vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { canonicalAssets, sourceSyncState, tokens } from "@/db/schema";
import { getDb } from "@/lib/db";

export const oldTime = new Date("2026-09-01T00:00:00Z");
export const address = "0x" + "a".repeat(40);
export const otherAddress = "0x" + "b".repeat(40);
export const asset = { id: "rhj-1", assetId: "1", symbol: "ABC", name: "Known", chainId: 4663, contractAddress: address, currentMultiplier: "2" };
type Row = Record<string, unknown>;
export function fakeDb(canonical: Row[] = [asset], priorCursor: unknown = null, failAfterWrites = Infinity, tokenPresent = true) {
  const state: Row = { lastSuccessAt: oldTime, cursor: priorCursor, status: "success", recordsProcessed: 99 };
  const stateWrites: Row[] = [];
  const writes: Array<{ table: unknown; values: Row }> = [];
  const token: Row = { symbol: "ABC", name: "Known", decimals: 18, isVerified: true, isProxy: true, implementationAddress: otherAddress };
  const conditions: unknown[][] = [];
  const chain = (rows: Row[]) => {
    const promise = Promise.resolve(rows);
    return Object.assign(promise, {
      where: (condition: SQL) => { conditions.push(new PgDialect().sqlToQuery(condition).params); return chain(rows); },
      limit: () => chain(rows), orderBy: () => chain(rows),
    });
  };
  const db = {
    select: () => ({ from: (table: unknown) => chain(table === canonicalAssets ? canonical : table === sourceSyncState ? [state] : []) }),
    insert: (table: unknown) => ({ values: (values: Row) => {
      const save = () => { if (table !== sourceSyncState) {
        if (writes.length >= failAfterWrites) throw new Error("mock persistence failure");
        writes.push({ table, values });
      } };
      return { then: (resolve: (value?: unknown) => unknown) => { save(); return Promise.resolve(resolve()); },
        onConflictDoUpdate: async ({ set }: { set: Row }) => { if (table === sourceSyncState) Object.assign(state, set); else save(); } };
    } }),
    update: (table: unknown) => ({ set: (values: Row) => ({ where: (condition: SQL) => {
      const save = async () => {
        conditions.push(new PgDialect().sqlToQuery(condition).params);
        if (table === sourceSyncState) { stateWrites.push(values); Object.assign(state, values); }
        else {
          if (table === tokens && !tokenPresent) return [];
          if (writes.length >= failAfterWrites) throw new Error("mock persistence failure");
          writes.push({ table, values }); if (table === tokens) Object.assign(token, values);
        }
        return [{ address }];
      };
      return { then: (resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) => save().then(resolve, reject), returning: save };
    } }) }),
  };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return { state, stateWrites, writes, token, conditions };
}
