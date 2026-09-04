import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/tokens/", "/watchlist"],
    },
    sitemap: "https://robinwatch-mu.vercel.app/sitemap.xml",
  };
}
