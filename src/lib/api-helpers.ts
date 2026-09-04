import { NextResponse } from "next/server";
import { hasDatabase } from "@/lib/db";
import { getSnapshotStatus } from "@/lib/snapshot";

/**
 * Fallback mode: when Cloud Postgres is not configured, the API serves the
 * last published Blob snapshot and otherwise returns an explicit empty state.
 */
export function uiOnlyResponse(endpoint: string) {
  return NextResponse.json({
    data: [],
    meta: {
      uiOnly: true,
      message:
        "Cloud database is not configured and no published snapshot is available.",
      endpoint,
      snapshot: getSnapshotStatus(),
    },
  });
}

/** True when the Neon Postgres database is configured. */
export function dataAvailable(): boolean {
  return hasDatabase();
}

export type DatabaseAttempt<T> =
  | { ok: true; data: T; attempted: true }
  | { ok: false; attempted: boolean };

/** Query Neon when configured without preventing the route from using its snapshot fallback. */
export async function tryDatabase<T>(load: () => Promise<T>): Promise<DatabaseAttempt<T>> {
  if (!dataAvailable()) return { ok: false, attempted: false };
  try {
    return { ok: true, data: await load(), attempted: true };
  } catch (error) {
    console.error("Neon query failed; attempting snapshot fallback:", error);
    return { ok: false, attempted: true };
  }
}
