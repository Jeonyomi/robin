import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("offsets LP refreshes away from the ten-minute transfer pulse", () => {
  const source = readFileSync("ops/install-lp-task.ps1", "utf8");
  expect(source).toContain("RepetitionInterval (New-TimeSpan -Minutes 5)");
  expect(source).toContain("while ($first.Minute % 5 -ne 3)");
});
