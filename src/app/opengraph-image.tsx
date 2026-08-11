import { ImageResponse } from "next/og";
import { SITE } from "@/config/tracks";

// §34 — social sharing image.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = SITE.title;

/**
 * Deliberately typographic and self-contained: it renders identically whether or
 * not Spotify credentials are configured, and a card that depends on a live API
 * call is a card that eventually renders blank into a permanent social cache.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 96,
          backgroundColor: "#08080a",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 26,
            letterSpacing: 8,
            textTransform: "uppercase",
            color: "#1db954",
          }}
        >
          Now playing
        </div>
        <div
          style={{
            fontSize: 104,
            fontWeight: 700,
            color: "#f2f2f4",
            lineHeight: 1.05,
            marginTop: 28,
          }}
        >
          {SITE.name}
        </div>
        <div style={{ fontSize: 34, color: "#8f8f9a", marginTop: 28, lineHeight: 1.35 }}>
          A music player that happens to be a website.
        </div>
      </div>
    ),
    size,
  );
}
