"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

const PUBLIC_PATHS = new Set([
  "/", "/stock-tokens", "/capital-flow", "/opportunities", "/liquidity",
  "/meme-leaders", "/tokens", "/smart-money", "/watchlist", "/alerts",
  "/settings/data-sources", "/legal",
]);

/** Public production page views only; never forward query strings or identifiers. */
export function analyticsBeforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    if (event.type !== "pageview") return null;
    if (typeof navigator !== "undefined") {
      const privacy = navigator as Navigator & { globalPrivacyControl?: boolean };
      if (privacy.doNotTrack === "1" || privacy.globalPrivacyControl === true) return null;
    }
    if (typeof localStorage !== "undefined" && localStorage.getItem("va-disable")) return null;
    const url = new URL(event.url);
    if (url.origin !== "https://robinwatch24.vercel.app" || url.username || url.password) return null;
    if (/^\/tokens\/0x[0-9a-fA-F]{40}$/.test(url.pathname)) url.pathname = "/tokens/[address]";
    else if (!PUBLIC_PATHS.has(url.pathname)) return null;
    url.search = "";
    url.hash = "";
    return { type: "pageview", url: url.toString() };
  } catch {
    // Invalid URLs or inaccessible opt-out preferences must not leak an event.
    return null;
  }
}

export function SiteAnalytics() {
  if (process.env.NODE_ENV !== "production") return null;
  return <Analytics mode="production" debug={false} beforeSend={analyticsBeforeSend} />;
}
