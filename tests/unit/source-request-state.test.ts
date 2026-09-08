import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createFileSourceState } from "@/lib/sources/source-request-state";
import { createSourceRequester } from "@/lib/sources/source-request";
const dirs: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function path() { const dir = await mkdtemp(join(tmpdir(), "source-policy-")); dirs.push(dir); return join(dir, "state.json"); }
function dependencies(file: string, fetcher: typeof fetch) {
  let now = Date.parse("2027-01-15T08:00:00Z");
  return { state: createFileSourceState(file), fetch: fetcher, now: () => now, wait: async (ms: number) => { now += ms; }, limits: { dailyCalls: 2 } };
}
describe("durable source policy state", () => {
  it("persists cooldown and daily reservations across independent stores without storing request secrets", async () => {
    const file = await path();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 403 }));
    await expect(createSourceRequester(dependencies(file, fetcher))("blockscout", "https://invalid/?url-secret", { scope: "scope-secret", headers: { Authorization: "header-secret" } })).rejects.toMatchObject({ status: 403 });
    await expect(createSourceRequester(dependencies(file, fetcher))("blockscout", "https://invalid", { scope: "scope-secret" })).rejects.toMatchObject({ code: "cooldown" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockImplementation(async () => Response.json({}));
    await createSourceRequester(dependencies(file, fetcher))("blockscout", "https://invalid", { scope: "stats" });
    await expect(createSourceRequester(dependencies(file, fetcher))("blockscout", "https://invalid", { scope: "stats" })).rejects.toMatchObject({ code: "budget" });
    const raw = await readFile(file, "utf8");
    expect(raw).not.toMatch(/secret|https|Authorization/);
    expect(JSON.parse(raw).providers.blockscout.calls).toBe(2);
  });
  it.each(["{broken", "{}", '{"version":1,"providers":{"blockscout":{"calls":-1}}}'])("fails closed before fetch on corrupt durable state: %s", async raw => {
    const file = await path(); await writeFile(file, raw);
    const fetcher = vi.fn<typeof fetch>();
    await expect(createSourceRequester(dependencies(file, fetcher))("blockscout", "https://invalid")).rejects.toMatchObject({ code: "state" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readFile(file, "utf8")).toBe(raw);
  });
  it("does not lose reservations across two OS processes", async () => {
    const file = await path();
    const moduleUrl = pathToFileURL(resolve("src/lib/sources/source-request-state.ts")).href;
    const script = `import { createFileSourceState } from ${JSON.stringify(moduleUrl)}; const store=createFileSourceState(${JSON.stringify(file)}); for(let i=0;i<8;i++) await store.update(s=>{ const p=s.providers.blockscout ??= {day:'2027-01-15',calls:0,nextStart:0,cooldownUntil:0,scopes:{}}; p.calls++; });`;
    await Promise.all([1, 2].map(() => promisify(execFile)(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script])));
    expect(JSON.parse(await readFile(file, "utf8")).providers.blockscout.calls).toBe(16);
  });
  it("uses durable state only under the explicit collector flag", async () => {
    const file = await path(); await writeFile(file, "corrupt");
    vi.stubEnv("ROBINWATCH_SOURCE_STATE_PATH", file);
    vi.stubEnv("ROBINWATCH_COLLECTOR", "0");
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}));
    await expect(createSourceRequester({ fetch: fetcher })("robinhood", "https://invalid")).resolves.toEqual({});
    vi.stubEnv("ROBINWATCH_COLLECTOR", "1");
    await expect(createSourceRequester({ fetch: fetcher })("robinhood", "https://invalid")).rejects.toMatchObject({ code: "state" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
