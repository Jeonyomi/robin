import { test, expect, type Page } from "@playwright/test";
import { LP_LEADER_FRESH_MS, LpLeaderboardSchema, type LpLeaderboard, type LpLeader } from "../../src/lib/lp-leaders";

const ENDPOINT = "**/api/v1/lp-leaders";
const KEY = "robin:lp-workspace:v1";
const address = (digit: string) => `0x${digit.repeat(40)}`;
// Explicitly synthetic E2E contract fixtures. Never imported by application code.
function testFixtureRow(overrides: Partial<LpLeader> = {}): LpLeader {
  return { tokenId: "101", pool: address("1"), owner: address("2"), token0: { address: address("3"), symbol: "TEST", decimals: 6 }, token1: { address: address("4"), symbol: "WETH", decimals: 18 }, baseSymbol: "TEST", baseAddress: address("3"), feeTier: 3000, feeIncomeWeth: 12.5, capitalWeth: 2, fees0: "1234567", fees1: "100000000000000001", amount0: 3.5, amount1: 0.5, priceWethPerBase: 0.5, lowerWethPerBase: 0.49, upperWethPerBase: 0.51, rangeState: "in-range", rangeWidthPct: 4, nearestEdgePct: 2, structure: "concentrated", mintedAt: "2025-01-01T00:00:00.000Z", increases: 2, decreases: 1, collections: 3, transfers: 2, ...overrides };
}
function testFixtureBoard(overrides: Partial<LpLeaderboard> = {}): LpLeaderboard {
  return { chainId: 4663, protocol: "uniswap-v3", positionManager: address("5"), weth: address("4"), blockNumber: "12345", blockHash: `0x${"a".repeat(64)}`, observedAt: new Date().toISOString(), totalNfts: 1000, sampled: 4, eligible: 2, excluded: 1, unsupported: 1, sampleMethod: "stratified-enumerable-indices-v1", ranking: "lifetime-native-weth-fees", rows: [testFixtureRow(), testFixtureRow({ tokenId: "102", baseSymbol: "SECOND", feeIncomeWeth: 1, capitalWeth: 50, rangeState: "above-range", structure: "wide" })], ...overrides };
}
async function fixture(page: Page, data: unknown = testFixtureBoard()) {
  await page.route(ENDPOINT, (route) => route.fulfill({ json: { data, error: null } }));
}
const rows = (page: Page) => page.getByTestId("leader-row");

test("REAL public API auto-loads NFT leaders and opens actual details without financial writes", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const writes: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  page.on("pageerror", (error) => errors.push(error.message));
  // No route interception or fabricated fallback in this real-source probe.
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/lp-leaders", { timeout: 125_000 });
  await page.goto("/liquidity");
  await expect(page.getByRole("heading", { name: "LP Leaders." })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  expect(body.error).toBeNull();
  const data = LpLeaderboardSchema.parse(body.data);
  expect(data.rows.length, "Real RPC must return observed eligible NFT rows; do not replace with fixtures").toBeGreaterThan(0);
  await expect(rows(page)).toHaveCount(data.rows.length);
  await expect(page.getByText("SHARED VERIFIED SNAPSHOT", { exact: true })).toBeVisible();
  await expect(page.locator(".leaders-observation time")).toHaveAttribute("datetime", data.observedAt);
  const top = [...data.rows].sort((a, b) => b.feeIncomeWeth - a.feeIncomeWeth || (BigInt(a.tokenId) < BigInt(b.tokenId) ? -1 : 1))[0];
  await rows(page).first().getByRole("button").click();
  const details = page.getByTestId("leader-details");
  await expect(details).toContainText(top.owner);
  await expect(details).toContainText(String(top.lowerWethPerBase));
  await expect(details).toContainText(`Raw recorded units: ${top.fees0}`);
  await expect(details.getByRole("link", { name: `NFT #${top.tokenId} ↗` })).toHaveAttribute("href", `https://robinhoodchain.blockscout.com/token/${data.positionManager}/instance/${top.tokenId}`);
  await testInfo.attach("observed-lp-leaders", { body: JSON.stringify(data, null, 2), contentType: "application/json" });
  for (const [name, width] of [["desktop", 1440], ["mobile", 390]] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Actual data fits ${name}`).toBe(true);
    const path = testInfo.outputPath(`lp-leaders-${name}.png`);
    await page.screenshot({ path, fullPage: false });
    await testInfo.attach(`lp-leaders-${name}`, { path, contentType: "image/png" });
  }
  const refreshChecks: { status: number; ms: number; rows: number; block: string; observedAt: string }[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = Date.now();
    const next = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/lp-leaders", { timeout: 15_000 });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    const refreshed = await next; expect(refreshed.status()).toBe(200);
    const nextData = LpLeaderboardSchema.parse((await refreshed.json()).data);
    expect(nextData.rows.length).toBeGreaterThan(0);
    expect(Date.now() - Date.parse(nextData.observedAt)).toBeLessThanOrEqual(LP_LEADER_FRESH_MS);
    await expect(rows(page)).toHaveCount(nextData.rows.length);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    refreshChecks.push({ status: refreshed.status(), ms: Date.now() - started, rows: nextData.rows.length, block: nextData.blockNumber, observedAt: nextData.observedAt });
  }
  await testInfo.attach("real-refresh-checks", { body: JSON.stringify(refreshChecks, null, 2), contentType: "application/json" });
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("fixture: fee ranking, inventory sort, range filters and exact native decimals", async ({ page }) => {
  await fixture(page); await page.goto("/liquidity");
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText("#101");
  await expect(page.getByTestId("leader-coverage")).toContainText("1000");
  await rows(page).first().getByRole("button").click();
  await expect(page.getByTestId("leader-details")).toContainText("1.234567");
  await expect(page.getByTestId("leader-details")).toContainText("0.100000000000000001");
  await expect(page.getByTestId("leader-details")).toContainText("Concentrated liquidity");
  await page.getByLabel("Sort by").selectOption("capital");
  await expect(rows(page).first()).toContainText("#102");
  await page.getByLabel("Range state").selectOption("out");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("#102");
  await page.getByLabel("Range state").selectOption("closed");
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText("No positions match this range filter.", { exact: false })).toBeVisible();
  await page.getByLabel("Range state").selectOption("all");
  await expect(rows(page)).toHaveCount(2);
});

for (const kind of ["unavailable", "stale", "future", "invalid"] as const) {
  test(`fixture: ${kind} response withholds the ranking`, async ({ page }) => {
    if (kind === "unavailable") await page.route(ENDPOINT, (route) => route.fulfill({ status: 503, json: { data: null, error: "E2E simulated RPC unavailable" } }));
    else await fixture(page, kind === "stale" || kind === "future" ? testFixtureBoard({ observedAt: new Date(Date.now() + (kind === "stale" ? -LP_LEADER_FRESH_MS - 1000 : LP_LEADER_FRESH_MS + 1000)).toISOString() }) : { ...testFixtureBoard(), rows: [{ tokenId: "<img>" }] });
    await page.goto("/liquidity");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(kind === "invalid" ? "Invalid" : kind === "stale" || kind === "future" ? "stale" : "unavailable");
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByTestId("leader-coverage")).toHaveCount(0);
  });
}

test("fixture: failed refresh hides prior success and in-flight clicks deduplicate", async ({ page }) => {
  let calls = 0;
  await page.route(ENDPOINT, async (route) => {
    calls++;
    if (calls === 1) await route.fulfill({ json: { data: testFixtureBoard(), error: null } });
    else { await new Promise((resolve) => setTimeout(resolve, 300)); await route.fulfill({ status: 503, json: { data: null, error: "E2E refresh failure" } }); }
  });
  await page.goto("/liquidity"); await expect(rows(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Refresh", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); button.click(); });
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("unavailable");
  expect(calls).toBe(2);
});

for (const failure of [
  { name: "rate-limit", status: 429, retryAfter: "60", seconds: 60 },
  { name: "unavailable with Retry-After", status: 503, retryAfter: "9", seconds: 9 },
  { name: "unavailable without Retry-After", status: 503, retryAfter: undefined, seconds: 15 },
] as const) {
  test(`fixture: ${failure.name} cooldown blocks click spam and recovers only on manual retry`, async ({ page }) => {
    const now = new Date(); await page.clock.install({ time: now });
    let calls = 0;
    let recoveredAt = "";
    await page.route(ENDPOINT, async (route) => {
      calls++;
      if (calls === 2) {
        await route.fulfill({ status: failure.status, headers: failure.retryAfter ? { "Retry-After": failure.retryAfter } : {}, json: { data: null, error: "E2E synthetic upstream failure, not a real RPC response" } });
      } else {
        recoveredAt = new Date(await page.evaluate(() => Date.now())).toISOString();
        await route.fulfill({ json: { data: testFixtureBoard({ observedAt: recoveredAt }), error: null } });
      }
    });
    await page.goto("/liquidity"); await expect(rows(page)).toHaveCount(2);
    await rows(page).first().getByRole("button").click();
    await expect(page.getByTestId("leader-details")).toBeVisible();
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    const retry = page.getByRole("button", { name: /^Retry in \d+s$/ });
    await expect(retry).toHaveText(`Retry in ${failure.seconds}s`);
    await expect(retry).toBeDisabled();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("unavailable");
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByTestId("leader-details")).toHaveCount(0);
    await expect(page.getByTestId("leader-coverage")).toHaveCount(0);
    await retry.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); button.click(); });
    expect(calls, "Disabled clicks must not request the API / RPC").toBe(2);
    await page.clock.fastForward((failure.seconds - 1) * 1000);
    await expect(retry).toHaveText("Retry in 1s");
    await expect(retry).toBeDisabled();
    await retry.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await page.clock.fastForward(999);
    await expect(retry).toBeDisabled();
    expect(calls, "Countdown is local; no background API / RPC polling").toBe(2);
    await page.clock.fastForward(1);
    const refresh = page.getByRole("button", { name: "Refresh", exact: true });
    await expect(refresh).toBeEnabled();
    await page.clock.fastForward(5000);
    expect(calls, "Reaching the deadline must not automatically retry").toBe(2);
    await refresh.click();
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".leaders-observation time")).toHaveAttribute("datetime", recoveredAt);
    expect(calls).toBe(3);
  });
}

test("fixture: shared snapshot retains observedAt on refresh and expires without any background request", async ({ page }) => {
  const now = new Date(); await page.clock.install({ time: now });
  let calls = 0;
  await page.route(ENDPOINT, (route) => { calls++; return route.fulfill({ json: { data: testFixtureBoard({ observedAt: now.toISOString() }), error: null } }); });
  await page.goto("/liquidity"); await expect(rows(page)).toHaveCount(2);
  await expect(page.getByText("SHARED VERIFIED SNAPSHOT", { exact: true })).toBeVisible();
  await expect(page.getByText(/at most 5 minutes old/i)).toBeVisible();
  await expect(page.getByText(/revalidated on demand after 90 seconds/i)).toBeVisible();
  await page.clock.fastForward(LP_LEADER_FRESH_MS / 2);
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator(".leaders-observation time")).toHaveAttribute("datetime", now.toISOString());
  expect(calls).toBe(2);
  await page.clock.fastForward(LP_LEADER_FRESH_MS / 2 + 2);
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("stale");
  expect(calls).toBe(2);
});

test("fixture: empty eligible sample is distinct from unavailable and loading", async ({ page }) => {
  await page.route(ENDPOINT, async (route) => { await new Promise((resolve) => setTimeout(resolve, 400)); await route.fulfill({ json: { data: testFixtureBoard({ rows: [], eligible: 0, excluded: 3 }), error: null } }); });
  await page.goto("/liquidity");
  await expect(page.getByText("Reading public NFT records…", { exact: false })).toBeVisible();
  await expect(page.getByText("No eligible WETH-pair positions in this observation.", { exact: false })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

test("fixture: hostile symbols render as text, official links only, legacy storage untouched", async ({ page }) => {
  const original = 'broken legacy backup <img src=x onerror=alert(1)>';
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: KEY, value: original });
  await fixture(page, testFixtureBoard({ rows: [testFixtureRow({ baseSymbol: "<img src=x onerror=x>" })] }));
  await page.goto("/liquidity");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("<img src=x onerror=x>");
  await rows(page).getByRole("button").click();
  await expect(page.locator(".leaders-shell img")).toHaveCount(0);
  for (const link of await page.getByTestId("leader-details").getByRole("link").all()) expect(new URL((await link.getAttribute("href"))!).origin).toBe("https://robinhoodchain.blockscout.com");
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(original);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /connect wallet|subscribe|trade|add scenario|import|reset/i })).toHaveCount(0);
  await page.reload(); await expect(rows(page)).toHaveCount(1);
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(original);
});

test("fixture: expanded layouts fit 320, 390, 768 and 1440 without page overflow", async ({ page }) => {
  await fixture(page); await page.goto("/liquidity"); await expect(rows(page)).toHaveCount(2);
  await rows(page).first().getByRole("button").click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId("leader-details")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `No page overflow at ${width}px`).toBe(true);
  }
});
