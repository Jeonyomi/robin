import { describe, expect, it } from "vitest";
import { pickWindow } from "@/lib/snapshot";

describe("snapshot observation window identity", () => {
  it("does not present a 24h snapshot under a missing 1h or 6h request", () => {
    const map = { "24h": { window: "24h", value: 24 } };
    expect(pickWindow(map, "1h")).toBeUndefined();
    expect(pickWindow(map, "6h")).toBeUndefined();
    expect(pickWindow(map, "24h")).toBe(map["24h"]);
  });
  it("preserves exact entries including empty lists and rejects absent maps", () => {
    const map = { "1h": [], "24h": ["synthetic"] };
    expect(pickWindow(map, "1h")).toBe(map["1h"]);
    expect(pickWindow(undefined, "1h")).toBeUndefined();
  });
});
