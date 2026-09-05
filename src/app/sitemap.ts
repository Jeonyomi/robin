import type { MetadataRoute } from "next";

const baseUrl = "https://robinwatch-mu.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-09-04T00:00:00Z");
  return [
    { url: `${baseUrl}/`, lastModified, changeFrequency: "hourly", priority: 1 },
    { url: `${baseUrl}/stock-tokens`, lastModified, changeFrequency: "hourly", priority: 0.8 },
    { url: `${baseUrl}/capital-flow`, lastModified, changeFrequency: "hourly", priority: 0.8 },
    { url: `${baseUrl}/opportunities`, lastModified, changeFrequency: "weekly", priority: 0.5 },
    { url: `${baseUrl}/liquidity`, lastModified: new Date("2026-09-05T00:00:00Z"), changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/settings/data-sources`, lastModified, changeFrequency: "hourly", priority: 0.6 },
    { url: `${baseUrl}/legal`, lastModified, changeFrequency: "monthly", priority: 0.4 },
  ];
}
