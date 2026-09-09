import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("offsets LP refreshes away from the ten-minute transfer pulse", () => {
  const source = readFileSync("ops/install-lp-task.ps1", "utf8");
  expect(source).toContain("RepetitionInterval (New-TimeSpan -Minutes 5)");
  expect(source).toContain("while ($first.Minute % 5 -ne 3)");
});

it("describes the deployed five-minute schedule and ten-minute freshness bound", () => {
  const source = readFileSync("src/app/liquidity/explorer.tsx", "utf8");
  expect(source).toContain("about every 5 minutes, at most 10 minutes old");
});
