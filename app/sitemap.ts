import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_ORIGIN,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_ORIGIN}/datenschutz`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_ORIGIN}/impressum`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_ORIGIN}/nutzungsbedingungen`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
