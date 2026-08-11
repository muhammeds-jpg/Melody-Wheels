import type { MetadataRoute } from "next";
import { SITE } from "@/config/tracks";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.description,
    start_url: "/",
    display: "standalone",
    background_color: "#08080a",
    theme_color: "#08080a",
    // Declared maskable as well as any: without a maskable entry Android
    // letterboxes the PNG inside a white circle instead of filling the
    // adaptive-icon shape. Safe for these icons because gen-icons.mjs draws the
    // disc at r=0.34 of the canvas, inside the r=0.4 maskable safe zone — a
    // fuller-bleed icon would need its own padded variant.
    //
    // Listed as separate entries per purpose rather than the spec's
    // space-separated "any maskable": Next's Manifest type models purpose as a
    // single value, so the combined string is a type error.
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
