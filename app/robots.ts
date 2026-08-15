import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site-metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    // Private HTML routes stay crawlable so their noindex metadata can be read.
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
