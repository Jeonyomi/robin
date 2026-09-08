import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Worker-local, durable provider cooldown. Reading it never extends the deadline. */
export function remainingLpCooldown(file: string, now = Date.now()): number {
  if (!existsSync(file)) return 0;
  if (statSync(file).size > 512) throw new Error("Invalid LP collector cooldown state.");
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || !("untilMs" in value) || typeof value.untilMs !== "string" || !/^\d{1,20}$/.test(value.untilMs)) throw new Error("Invalid LP collector cooldown state.");
  const left = BigInt(value.untilMs) - BigInt(now);
  const seconds = left > BigInt(0) ? Number((left + BigInt(999)) / BigInt(1000)) : 0;
  if (!Number.isSafeInteger(seconds)) throw new Error("LP collector cooldown requires manual review.");
  return seconds;
}
export function persistLpCooldown(file: string, seconds: number, now = Date.now()) {
  if (!Number.isSafeInteger(seconds) || seconds < 1) throw new Error("Invalid LP cooldown duration.");
  const hold = Math.max(seconds, remainingLpCooldown(file, now));
  const untilMs = (BigInt(now) + BigInt(hold) * BigInt(1000)).toString();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify({ untilMs }), { mode: 0o600 });
  renameSync(temporary, file);
}
