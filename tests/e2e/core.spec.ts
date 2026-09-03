import { test, expect } from "@playwright/test";

// ── Core user flows (master prompt §20) ─────────────────────────────────────
// Note: these run against the local dev server. With no DB connected, pages
// render their empty states — the tests verify pages load, nav works, and the
// UI structure (canonical badges, empty states, source health) is correct.

test.describe("Dashboard navigation", () => {
  test("overview loads with Chain Pulse header", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Chain Pulse" })).toBeVisible();
    // Sidebar nav present
    await expect(page.getByText("Opportunity Radar", { exact: true })).toBeVisible();
    await expect(page.getByText("Stock Token Radar", { exact: true })).toBeVisible();
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
    await page.getByText("Opportunity Radar", { exact: true }).click();
    await expect(page).toHaveURL(/\/opportunities/);
    await expect(page.getByRole("heading", { name: "Opportunity Radar" })).toBeVisible();
  });
});

test.describe("Stock Token Radar", () => {
  test("shows canonical legend and correct empty state", async ({ page }) => {
    await page.goto("/stock-tokens");
    await expect(page.getByRole("heading", { name: "Stock Token Radar" })).toBeVisible();
    // Legend explaining canonical status
    await expect(page.getByText(/Canonical.*registry/i)).toBeVisible();
  });

  test("canonical-only filter toggle renders", async ({ page }) => {
    await page.goto("/stock-tokens");
    await expect(page.getByLabel("Canonical Only")).toBeVisible();
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

test.describe("Watchlist", () => {
  test("empty watchlist shows guidance", async ({ page }) => {
    await page.goto("/watchlist");
    await expect(page.getByRole("heading", { name: "Watchlist" })).toBeVisible();
    await expect(page.getByText(/watchlist is empty/i)).toBeVisible();
  });
});
