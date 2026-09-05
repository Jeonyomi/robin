import { test, expect, type Page } from "@playwright/test";

const KEY = "robin:lp-workspace:v1";
async function fill(page: Page, label = "E2E scenario, not live data") {
  const fields = { label, baseSymbol: "BASE", quoteSymbol: "QUOTE", entryPrice: "1", currentPrice: "4", lowerPrice: "0.25", upperPrice: "4", capitalQuote: "100" };
  for (const [name, value] of Object.entries(fields)) await page.locator(`input[name="${name}"]`).fill(value);
  await page.getByRole("button", { name: "I observed this price just now" }).click();
}

test("empty, save, calculation, persistence, fee update and no financial network write", async ({ page }) => {
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.method() !== "GET" && request.method() !== "HEAD") writes.push(request.url()); });
  await page.goto("/liquidity");
  await expect(page.getByRole("heading", { name: "LP Workspace", exact: true })).toBeVisible();
  await expect(page.getByText("Scenario mode, not a connected portfolio.")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await fill(page);
  await page.getByRole("button", { name: "Add scenario" }).click();
  const card = page.getByRole("article");
  await expect(card).toHaveCount(1);
  await expect(card.getByText("Above range", { exact: true })).toBeVisible();
  await expect(card.locator(".lp-readouts > div").filter({ hasText: "Modeled LP value" })).toContainText("150");
  await expect(card.locator(".lp-readouts > div").filter({ hasText: "Same-entry Hold value" })).toContainText("250");
  await expect(card.locator(".lp-readouts > div").filter({ hasText: "Historical fee APR" })).toContainText("Not available");
  await expect(card.locator(".lp-readouts > div").filter({ hasText: "divergence / IL" })).toContainText("-100");
  await card.getByText("Inspect range scenarios & calculation basis").click();
  await expect(card.getByRole("table")).toBeVisible();
  await page.reload();
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "Edit inputs" }).click();
  await page.getByText("Fees & costs · optional", { exact: true }).click();
  for (const [name, value] of Object.entries({ feesQuote: "10", costsQuote: "2", elapsedDays: "10" })) await page.locator(`input[name="${name}"]`).fill(value);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(card.locator(".lp-readouts > div").filter({ hasText: "Historical fee APR" })).toContainText("365%");
  await expect(card.locator(".lp-readouts > div").filter({ hasText: "Net vs Hold" })).toContainText("-92");
  await expect(card.locator(".lp-readouts > div").filter({ hasText: "Net PnL" })).toContainText("+58");
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("invalid range cannot persist; small narrow range warns and stale input never claims live", async ({ page }) => {
  await page.goto("/liquidity");
  await fill(page);
  await page.locator('input[name="lowerPrice"]').fill("2");
  await page.getByRole("button", { name: "Add scenario" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await page.locator('input[name="lowerPrice"]').fill("0.98");
  await page.locator('input[name="upperPrice"]').fill("1.02");
  await page.locator('input[name="currentPrice"]').fill("1");
  await page.locator('input[name="observedAt"]').fill("2020-01-01T00:00");
  await page.getByRole("button", { name: "Add scenario" }).click();
  await expect(page.getByRole("article").getByText("Stale input · review")).toBeVisible();
  await expect(page.getByText(/Narrow range: a small move/)).toBeVisible();
});

test("JSON export/import, malicious labels remain text, invalid backup preserves data", async ({ page }) => {
  await page.goto("/liquidity");
  await fill(page, "<img src=x onerror=alert(1)>");
  await page.getByRole("button", { name: "Add scenario" }).click();
  // Web Lock writes are asynchronous; a zero-image assertion also passes
  // before the saved article exists, so first wait for the persisted record.
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article").locator("img")).toHaveCount(0);
  const original = await page.evaluate((key) => localStorage.getItem(key), KEY);
  expect(original).not.toBeNull();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("robin-lp-workspace.json");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(JSON.parse(original!));
  await page.getByLabel("Import workspace JSON").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"version":99,"positions":[]}') });
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(original);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Remove/ }).click();
  await expect(page.getByRole("article")).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Import workspace JSON").setInputFiles({ name: "restore.json", mimeType: "application/json", buffer: Buffer.from(original!) });
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("status")).toContainText("unverified");
});

test("corrupt storage is preserved until explicit reset; storage failure never says saved", async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "broken-original"), KEY);
  await page.goto("/liquidity");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Nothing was overwritten");
  await expect(page.getByRole("button", { name: "Add scenario" })).toBeDisabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe("broken-original");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset local storage" }).click();
  await expect(page.getByRole("button", { name: "Add scenario" })).toBeEnabled();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException("Quota exhausted", "QuotaExceededError"); }; });
  await fill(page);
  await page.getByRole("button", { name: "Add scenario" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Quota");
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("two tabs synchronize and stale editing cannot overwrite a newer revision", async ({ page, context }) => {
  await page.goto("/liquidity"); await fill(page); await page.getByRole("button", { name: "Add scenario" }).click();
  const other = await context.newPage(); await other.goto("/liquidity");
  await expect(other.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Edit inputs" }).click();
  await other.getByRole("button", { name: "Edit inputs" }).click();
  await other.locator('input[name="currentPrice"]').fill("2");
  await other.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("article").locator(".lp-price-line > strong")).toHaveText("2");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("another tab");
  await other.close();
});

test("simultaneous queued saves never both report success while losing a scenario", async ({ page, context }) => {
  await page.goto("/liquidity"); await fill(page, "Concurrent A");
  const other = await context.newPage(); await other.goto("/liquidity"); await fill(other, "Concurrent B");
  const keeper = await context.newPage(); await keeper.goto("/legal");
  await keeper.evaluate((key) => {
    const state = window as unknown as { releaseLock: () => void; lockReady: boolean };
    void navigator.locks.request(`${key}:write`, async () => {
      state.lockReady = true;
      await new Promise<void>((resolve) => { state.releaseLock = resolve; });
    });
  }, KEY);
  await expect.poll(() => keeper.evaluate(() => (window as unknown as { lockReady: boolean }).lockReady)).toBe(true);
  await Promise.all([page.getByRole("button", { name: "Add scenario" }).click(), other.getByRole("button", { name: "Add scenario" }).click()]);
  await keeper.evaluate(() => (window as unknown as { releaseLock: () => void }).releaseLock());
  await expect.poll(async () => (await page.getByRole("status").count()) + (await other.getByRole("status").count())).toBe(1);
  await expect.poll(async () => (await page.getByRole("main").getByRole("alert").count()) + (await other.getByRole("main").getByRole("alert").count())).toBe(1);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).positions.length, KEY)).toBe(1);
  await keeper.close(); await other.close();
});

test("onchain inspector reads a real public position and fails closed after input change", async ({ page, request }) => {
  test.setTimeout(50_000);
  // This is a real public protocol NFT probe, not a fabricated response or user position.
  const invalid = await request.get("/api/v1/lp-position?tokenId=not-an-id");
  expect(invalid.status()).toBe(400);
  await page.goto("/liquidity");
  await page.getByLabel("Uniswap v3 position ID").fill("1");
  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/v1/lp-position?tokenId=1"));
  await page.getByRole("button", { name: "Read position", exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  expect(body.data.chainId).toBe(4663);
  expect(body.data.positionManager.toLowerCase()).toBe("0x73991a25c818bf1f1128deaab1492d45638de0d3");
  expect(body.data.factory.toLowerCase()).toBe("0x1f7d7550b1b028f7571e69a784071f0205fd2efa");
  expect(body.meta.fees).toBe("withheld");
  expect(body.meta.performance).toBe("withheld");
  expect(body.data.priceToken1PerToken0).toBeGreaterThan(0);
  await expect(page.locator(".lp-chain-result")).toBeVisible();
  await page.getByText("Verify pool, owner and raw state").click();
  await expect(page.locator(".lp-raw-state")).toContainText(body.data.blockHash);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Explicit fault injection tests the UI error gate; it does not replace the live success probe above.
  await page.route("**/api/v1/lp-position?tokenId=2", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ data: null, error: "RPC unavailable (E2E fault injection)" }) }));
  await page.getByLabel("Uniswap v3 position ID").fill("2");
  await expect(page.locator(".lp-chain-result")).toHaveCount(0);
  await page.getByRole("button", { name: "Read position", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("unavailable");
  await expect(page.locator(".lp-chain-result")).toHaveCount(0);
});

test("desktop and mobile layouts, legal navigation and no horizontal overflow", async ({ page }) => {
  await page.goto("/legal");
  await page.getByRole("navigation", { name: "Primary navigation", exact: true }).getByRole("link", { name: /LP Workspace/ }).click();
  await expect(page).toHaveURL(/\/liquidity$/);
  await fill(page, "A very long conviction scenario label to test narrow layouts");
  await page.getByRole("button", { name: "Add scenario" }).click();
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "LP Workspace", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
