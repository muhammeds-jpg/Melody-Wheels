import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * `next dev` and `next build` both write to .next and will corrupt each
   * other's output — the symptom is a build that compiles fine and then fails
   * "Collecting page data" with PageNotFoundError. Set NEXT_DIST_DIR to build
   * while a dev server is running.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  /**
   * Silences the dev-only cross-origin warning when the site is opened from
   * another device on the LAN. Dev server only — it has no effect on production.
   *
   * Note that Spotify login will NOT work over a LAN IP: OAuth needs the exact
   * registered redirect URI, and the SDK needs a secure context. Use
   * http://127.0.0.1:3000 for anything involving playback.
   */
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.24"],
  images: {
    // Album artwork is hotlinked rather than re-hosted: Spotify's developer
    // terms restrict copying and modifying their images.
    remotePatterns: [
      // Spotify serves album art from several hosts, and which one you get back
      // varies by region and by endpoint. `npm run sync` records whichever it
      // was handed, so all of them have to be allowed or next/image throws.
      { protocol: "https", hostname: "i.scdn.co", pathname: "/image/**" },
      { protocol: "https", hostname: "image-cdn-ak.spotifycdn.com", pathname: "/image/**" },
      { protocol: "https", hostname: "image-cdn-fa.spotifycdn.com", pathname: "/image/**" },
      // YouTube thumbnails, used only when a track has no Spotify artwork.
      { protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" },
      // Apple Music artwork, from the older iTunes-sourced catalogue.
      { protocol: "https", hostname: "is1-ssl.mzstatic.com", pathname: "/image/**" },
    ],
    formats: ["image/webp"],
    // Next 16 will reject any quality not declared here. 85 is what the
    // backdrop requests; 75 is next/image's default for everything else.
    qualities: [75, 85],
  },
  // §29 — keep lucide-react from pulling its barrel into the client bundle.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
