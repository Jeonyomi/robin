import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BeforeSendEvent } from "@vercel/analytics";
type AnalyticsProps = { mode: string; debug: boolean; beforeSend: (event: BeforeSendEvent) => BeforeSendEvent | null };
const analytics = vi.hoisted(() => vi.fn<(props: AnalyticsProps) => null>(() => null));
vi.mock("@vercel/analytics/next", () => ({ Analytics: analytics }));
vi.mock("next/font/google", () => ({ Inter: () => ({ variable: "--font-inter" }) }));
import RootLayout from "../../src/app/layout";

beforeEach(() => {
  analytics.mockClear();
  vi.stubGlobal("React", React);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function mount() {
  renderToStaticMarkup(React.createElement(RootLayout, null, "Test content"));
}

function send(url: string, type: BeforeSendEvent["type"] = "pageview") {
  mount();
  return analytics.mock.calls[0][0].beforeSend({ type, url });
}

describe("analytics privacy boundary", () => {
  it("strips all query parameters and fragments without mutating the source event", () => {
    mount();
    const event: BeforeSendEvent = { type: "pageview", url: "https://robinwatch24.vercel.app/meme-leaders?wallet=TEST_ONLY&utm_source=test#position" };
    expect(analytics.mock.calls[0][0].beforeSend(event)).toEqual({ type: "pageview", url: "https://robinwatch24.vercel.app/meme-leaders" });
    expect(event.url).toContain("wallet=TEST_ONLY");
  });
  it("redacts token address paths to a route template", () => {
    expect(send(`https://robinwatch24.vercel.app/tokens/0x${"a".repeat(40)}?secret=TEST_ONLY`)).toEqual({ type: "pageview", url: "https://robinwatch24.vercel.app/tokens/[address]" });
  });
  it.each([
    "https://robinwatch24.vercel.app/api/v1/overview",
    "https://robinwatch24.vercel.app/admin",
    "https://robinwatch24.vercel.app/private/customer-test",
    "https://robinwatch24.vercel.app/tokens/not-an-address",
    "https://preview.vercel.app/",
    "https://other.example/",
    "http://robinwatch24.vercel.app/",
    "https://test:test@robinwatch24.vercel.app/",
    "not-a-url",
  ])("drops unsupported/private/noncanonical URL %s", (url) => expect(send(url)).toBeNull());
  it.each(["/", "/stock-tokens", "/capital-flow", "/opportunities", "/liquidity", "/meme-leaders", "/tokens", "/smart-money", "/watchlist", "/alerts", "/settings/data-sources", "/legal"])("keeps a supported public route %s", (path) => {
    expect(send(`https://robinwatch24.vercel.app${path}`)?.url).toBe(`https://robinwatch24.vercel.app${path}`);
  });
  it("drops custom events", () => expect(send("https://robinwatch24.vercel.app/", "event")).toBeNull());
  it("honors Do Not Track", () => {
    vi.stubGlobal("navigator", { doNotTrack: "1" });
    expect(send("https://robinwatch24.vercel.app/")).toBeNull();
  });
  it("honors Global Privacy Control", () => {
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    expect(send("https://robinwatch24.vercel.app/")).toBeNull();
  });
  it("honors the documented local va-disable opt-out", () => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === "va-disable" ? "1" : null });
    expect(send("https://robinwatch24.vercel.app/")).toBeNull();
  });
  it("fails closed if the browser blocks access to opt-out storage", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("storage blocked"); } });
    expect(send("https://robinwatch24.vercel.app/")).toBeNull();
  });
});

describe("site Web Analytics integration", () => {
  it("mounts the Next.js analytics adapter once with explicit production, quiet and privacy options", () => {
    mount();
    expect(analytics).toHaveBeenCalledTimes(1);
    expect(analytics.mock.calls[0][0]).toMatchObject({ mode: "production", debug: false, beforeSend: expect.any(Function) });
  });
  it("does not mount analytics in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    mount();
    expect(analytics).not.toHaveBeenCalled();
  });
});
