// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({ Inter: () => ({ variable: "font-inter" }) }));
vi.stubGlobal("React", React);

import RootLayout, { metadata } from "../../src/app/layout";

describe("official X profile", () => {
  it("attributes share cards to the official X account on the current domain", () => {
    expect(metadata.metadataBase?.toString()).toBe("https://robinwatch24.vercel.app/");
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      site: "@robinwatch24",
      creator: "@robinwatch24",
    });
  });

  it("links to Robinwatch from the shared header and footer safely", () => {
    const html = renderToStaticMarkup(React.createElement(RootLayout, null, "Page"));
    const document = new DOMParser().parseFromString(html, "text/html");
    for (const region of ["header", "footer"]) {
      const link = document.querySelector(`${region} a[href="https://x.com/robinwatch24"]`);
      expect(link, `${region} must expose the official X profile`).not.toBeNull();
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toContain("noopener");
      expect(link?.textContent).toContain("X");
    }
  });
});
