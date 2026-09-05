import { describe, expect, it } from "vitest";
import { lpSourceDiagnostic } from "../../src/lib/sources/uniswap-v3/source-error";

describe("LP source diagnostics: metadata only", () => {
  it("classifies nested rate limiting without printing private strings", () => {
    const secret = "https://private.invalid/API_KEY <script>secret</script>";
    const value = lpSourceDiagnostic({ name: "Error", message: secret, cause: { name: "HttpRequestError", status: 429, code: -32005, details: `Too Many Requests ${secret}` } });
    expect(value).toEqual([{ type: "Error", category: "other" }, { type: "HttpRequestError", status: 429, code: -32005, category: "rate-limit" }]);
    expect(JSON.stringify(value)).not.toMatch(/API_KEY|private|script|secret/);
  });
  it.each([["ZodError", "", "schema"], ["Error", "metadata not found", "historical-state"], ["Error", "request timed out", "timeout"], ["Error", "403 Forbidden", "access-denied"], ["Error", "invalid params", "invalid-request"], ["TypeError", "fetch failed", "network"]])("classifies %s/%s", (name, message, category) => {
    expect(lpSourceDiagnostic({ name, message })).toEqual([{ type: name, category }]);
  });
  it("ignores attacker-defined names, codes and bodies and bounds cause cycles", () => {
    const error = { name: "SECRET_NAME", message: "SECRET_MESSAGE", status: "SECRET_STATUS", code: "SECRET_CODE", body: { key: "SECRET_KEY" }, cause: null as unknown };
    error.cause = error;
    expect(lpSourceDiagnostic(error)).toEqual([{ type: "Other", category: "other" }]);
    expect(lpSourceDiagnostic(null)).toEqual([]);
    expect(lpSourceDiagnostic("secret")).toEqual([]);
  });
  it("redacts schema details while retaining useful expected types and field paths", () => {
    const value = lpSourceDiagnostic({ name: "ZodError", issues: [{ path: [0, "status", "SECRET_KEY"], expected: "string", message: "SECRET_MESSAGE", input: "SECRET_INPUT" }] });
    expect(value).toEqual([{ type: "ZodError", category: "schema", issues: [{ path: "0.status.field", expected: "string" }] }]);
    expect(JSON.stringify(value)).not.toContain("SECRET");
  });
  it("bounds deep cause chains", () => {
    let error: unknown = new Error("base");
    for (let i = 0; i < 20; i++) error = new Error("layer", { cause: error });
    expect(lpSourceDiagnostic(error)).toHaveLength(5);
  });
});
