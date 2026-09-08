import { spawn } from "node:child_process";
import { runActivityPulse } from "./lib/activity-pulse";

// Fixed executable/arguments, no shell. Each child shares the persisted source budget.
void runActivityPulse((stage) => new Promise<number>((resolve) => {
  const args = stage === "snapshot"
    ? ["--import", "tsx", "scripts/publish-snapshot.ts"]
    : ["--import", "tsx", "scripts/sync.ts", stage];
  console.log("PULSE_STAGE_START", JSON.stringify({ stage, startedAt: new Date().toISOString() }));
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(), stdio: "inherit", shell: false,
    env: { ...process.env, ROBINWATCH_COLLECTOR: "1" },
    timeout: 180_000,
  });
  child.once("error", () => resolve(1));
  child.once("close", (code) => {
    const exitCode = code ?? 1;
    console.log("PULSE_STAGE_RESULT", JSON.stringify({ stage, exitCode, finishedAt: new Date().toISOString() }));
    resolve(exitCode);
  });
})).then((result) => {
  console.log("PULSE_RESULT", JSON.stringify(result));
  process.exitCode = result.exitCode;
}).catch(() => { console.error("PULSE_FAILED"); process.exitCode = 1; });
