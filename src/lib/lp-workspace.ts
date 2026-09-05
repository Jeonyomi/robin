import { WorkspaceSchema, analyzePosition, type PositionInput } from "@/lib/domain/lp";

export const LP_STORAGE_KEY = "robin:lp-workspace:v1";
export const MAX_WORKSPACE_BYTES = 256_000;
export const INPUT_FRESHNESS_MS = 2 * 60 * 60 * 1000;
export type Workspace = { version: 1; positions: PositionInput[] };

/** User-entered scenarios only. Never interpreted as imported chain evidence. */
export function parseWorkspace(raw: string, now = Date.now()): Workspace {
  if (new TextEncoder().encode(raw).length > MAX_WORKSPACE_BYTES) throw new Error("Workspace exceeds 256 KB.");
  const parsed = WorkspaceSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`Invalid workspace: ${parsed.error.issues[0]?.message ?? "check inputs"}`);
  for (const position of parsed.data.positions) {
    if (Date.parse(position.observedAt) > now) throw new Error("Price observation time cannot be in the future.");
    analyzePosition(position); // Reject unrepresentable math before persistence or rendering.
  }
  return parsed.data;
}

export function inputAge(position: PositionInput, now: number): "recent" | "stale" | "invalid" {
  const age = now - Date.parse(position.observedAt);
  if (!Number.isFinite(age) || age < 0) return "invalid";
  return age > INPUT_FRESHNESS_MS ? "stale" : "recent";
}

export function serializeWorkspace(positions: PositionInput[]): string {
  return JSON.stringify(parseWorkspace(JSON.stringify({ version: 1, positions })), null, 2);
}
