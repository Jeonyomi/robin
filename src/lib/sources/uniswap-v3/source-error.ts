/** Log only allowlisted categories, never upstream messages, URLs or request bodies. */
export function lpSourceDiagnostic(error: unknown) {
  const names = new Set(["Error", "TypeError", "HttpRequestError", "RpcRequestError", "TimeoutError", "AbortError", "ZodError", "ContractFunctionExecutionError", "ContractFunctionRevertedError", "UnknownRpcError", "InvalidParamsRpcError", "InvalidInputRpcError"]);
  const result: { type: string; status?: number; code?: number; category: string; issues?: { path: string; expected: string }[] }[] = [];
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current);
    const item = current as Record<string, unknown>;
    const text = [item.message, item.details, item.shortMessage].filter((v) => typeof v === "string").join(" ");
    const category = item.status === 429 || item.code === 429 || /too many requests|rate.?limit|429/i.test(text) ? "rate-limit" : /timeout|timed out|aborted/i.test(text) ? "timeout" : /metadata not found|historical|pruned/i.test(text) ? "historical-state" : /forbidden|403|access denied/i.test(text) ? "access-denied" : /invalid params|invalid argument/i.test(text) ? "invalid-request" : /fetch failed|connect|network|ENOTFOUND/i.test(text) ? "network" : item.name === "ZodError" ? "schema" : "other";
    const fields = new Set(["status", "logs", "blockNumber", "blockHash", "timestamp", "removed", "data", "topics", "number", "hash", "address", "transactionHash", "logIndex"]);
    const types = new Set(["bigint", "number", "string", "boolean", "array", "object"]);
    const issues = item.name === "ZodError" && Array.isArray(item.issues) ? item.issues.slice(0, 4).map((issue: { path?: unknown[]; expected?: unknown }) => ({ path: Array.isArray(issue?.path) ? issue.path.slice(0, 5).map((key) => typeof key === "number" ? key : typeof key === "string" && fields.has(key) ? key : "field").join(".") : "", expected: typeof issue?.expected === "string" && types.has(issue.expected) ? issue.expected : "validation" })) : undefined;
    result.push({ type: typeof item.name === "string" && names.has(item.name) ? item.name : "Other", ...(typeof item.status === "number" && Number.isInteger(item.status) ? { status: item.status } : {}), ...(typeof item.code === "number" && Number.isInteger(item.code) ? { code: item.code } : {}), category, ...(issues ? { issues } : {}) });
    current = item.cause;
  }
  return result;
}
