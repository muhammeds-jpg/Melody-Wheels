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
    // Spotify album artwork. Hotlinked rather than re-hosted: Spotify's
    // developer terms restrict copying and modifying their images.
    remotePatterns: [
      // Spotify album art, for when the Web API integration is live.
      { protocol: "https", hostname: "i.scdn.co", pathname: "/image/**" },
      // Apple Music artwork, which ships with the preview catalogue.
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
