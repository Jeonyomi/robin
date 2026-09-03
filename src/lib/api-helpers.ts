import { NextResponse } from "next/server";
import { hasLocalDb } from "@/lib/db";

/**
 * UI-only mode: on Vercel (or any env without a local SQLite file), the API
 * returns empty data structures with an explicit note instead of crashing.
 * Data lives on the local machine — see `pnpm sync` and `pnpm dev`.
 */
export function uiOnlyResponse(endpoint: string) {
  return NextResponse.json({
    data: [],
    meta: {
      uiOnly: true,
      message:
        "UI-only deployment — on-chain data is stored and synced on the local machine. Run `pnpm dev` + `pnpm sync` there.",
      endpoint,
    },
  });
}

/** True when the local DB file exists and can be queried */
export function dataAvailable(): boolean {
  return hasLocalDb();
}
