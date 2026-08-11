import type { MetadataRoute } from "next";
import { SITE } from "@/config/tracks";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE.url, changeFrequency: "weekly", priority: 1 }];
}
