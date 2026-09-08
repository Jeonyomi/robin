export type PulseStage = "transfers" | "stats" | "snapshot";

/** Independent attempts: a successful publication never masks source failure. */
export async function runActivityPulse(execute: (stage: PulseStage) => Promise<number>) {
  const stages: { stage: PulseStage; exitCode: number }[] = [];
  for (const stage of ["transfers", "stats", "snapshot"] as const) {
    let exitCode = 1;
    try {
      const code = await execute(stage);
      exitCode = Number.isInteger(code) && code >= 0 ? code : 1;
    } catch { /* Preserve failure without copying process errors or credentials. */ }
    stages.push({ stage, exitCode });
  }
  return { stages, exitCode: stages.some((item) => item.exitCode !== 0) ? 1 : 0 };
}
