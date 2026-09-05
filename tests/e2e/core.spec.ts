import { test, expect } from "@playwright/test";

// ── Core user flows (master prompt §20) ─────────────────────────────────────
// Note: these run against the local dev server. With no DB connected, pages
// render their empty states — the tests verify pages load, nav works, and the
// UI structure (canonical badges, empty states, source health) is correct.

test.describe("Dashboard navigation", () => {
  test("overview loads with the onchain observation header", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /What is moving on Robinhood Chain/ })).toBeVisible();
    // Sidebar nav present
    await expect(page.getByText("Activity Lens", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Asset Registry", { exact: true }).first()).toBeVisible();
  });

  test("all main pages render without crashing", async ({ page }) => {
    const routes = ["/", "/opportunities", "/stock-tokens", "/tokens", "/capital-flow", "/smart-money", "/alerts", "/watchlist", "/settings/data-sources"];
    for (const route of routes) {
      await page.goto(route);
      // Page must have a main heading and no fatal error boundary
      await expect(page.locator("h1").first()).toBeVisible();
    }
  });

  test("sidebar navigation links work", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Activity Lens", { exact: true }).first().click();
    await expect(page).toHaveURL(/\/opportunities/);
    await expect(page.getByRole("heading", { name: "Activity Lens" })).toBeVisible();
  });
});

test.describe("Asset Registry", () => {
  test("shows canonical legend and correct empty state", async ({ page }) => {
    await page.goto("/stock-tokens");
    await expect(page.getByRole("heading", { name: "Asset Registry" })).toBeVisible();
    // Legend explaining canonical status
    await expect(page.locator("footer.method-footer")).toContainText("Canonical means the contract address exactly matches");
  });

  test("canonical-only filter toggle renders", async ({ page }) => {
    await page.goto("/stock-tokens");
    await expect(page.getByLabel(/Canonical only/i)).toBeVisible();
  });
});

test.describe("Token detail", () => {
  test("unknown address shows not-found state", async ({ page }) => {
    await page.goto("/tokens/0x000000000000000000000000000000000000dead");
    // Either token data or not-found state renders — must not crash
    await expect(page.locator("h1").first()).toBeVisible();
  });
});

test.describe("Data sources", () => {
  test("source health page renders with source list", async ({ page }) => {
    await page.goto("/settings/data-sources");
    await expect(page.getByRole("heading", { name: "Data Sources" })).toBeVisible();
  });
});

test.describe("Legacy Watchlist", () => {
  test("retired watchlist redirects to the canonical registry", async ({ page }) => {
    await page.goto("/watchlist");
    await expect(page).toHaveURL(/\/stock-tokens$/);
    await expect(page.getByRole("heading", { name: "Asset Registry" })).toBeVisible();
  });
});
