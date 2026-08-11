import type { MetadataRoute } from "next";
import { SITE } from "@/config/tracks";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/"] }],
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
