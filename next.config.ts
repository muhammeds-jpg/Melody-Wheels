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
   * OPEN THE SITE AT http://localhost:3000 — the hostname, never an IP.
   *
   * YouTube refuses to embed a large share of music videos when the embedding
   * origin is a bare IP address, and answers the IFrame player with error 150.
   * The app then falls back to 30-second previews, which looks exactly like a
   * broken catalogue and is not one. Measured over one 44-track playlist, same
   * browser, same minute:
   *
   *   http://localhost:3300      44/44 played
   *   http://127.0.0.1:3300      11/44 played, 33 refused
   *   http://192.168.1.24:3300   12/44 played, 32 refused
   *
   * 127.0.0.1 is no better than a LAN IP here: what matters is hostname vs IP
   * literal, not local vs remote. Use 127.0.0.1 only for the optional Spotify
   * OAuth round trip, whose registered redirect URI names it.
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
    // Next 16 will reject any quality not declared here, and 75 is next/image's
    // default. The backdrop used to ask for 85; it is a video now and goes
    // nowhere near the image optimizer, so nothing else asks for anything else.
    qualities: [75],
  },
  // §29 — keep lucide-react from pulling its barrel into the client bundle.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
