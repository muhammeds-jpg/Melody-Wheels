import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import { SITE } from "@/config/tracks";
import "@/styles/globals.css";

// Self-hosted by next/font, so there is no Google Fonts request at runtime.

/** UI voice: small, quiet, gets out of the way. */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans-stack",
});

/**
 * Display voice. A high-contrast serif is doing the real work here — it is what
 * stops the page reading as a default-stack template, and it sits with the warm,
 * painterly illustration in a way a geometric sans never would.
 */
const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-display",
});

/** §34 — lightweight but intentional. */
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: SITE.title,
  description: SITE.description,
  applicationName: SITE.name,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    url: SITE.url,
  },
  twitter: {
    card: "summary_large_image",
    creator: SITE.twitter,
    title: SITE.title,
    description: SITE.description,
  },
  /**
   * NO `icons` field, deliberately.
   *
   * Declaring one overrides Next's app/icon.* file convention wholesale — which
   * is a trap twice over. Naming only `apple` emitted no <link rel="icon"> at
   * all, and the tab fell back to a default globe. Naming `icon: "/icon.png"`
   * fixed that but emitted a bare, unversioned URL, so a browser that had cached
   * the old favicon kept showing it however many times the file was rebuilt.
   *
   * The file convention emits both links with a content hash on each URL, so a
   * new icon is a new URL and every cache picks it up. src/app/icon.png and
   * src/app/apple-icon.png are what it reads; `npm run gen:icons` writes them.
   */
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // §23 — enables env(safe-area-inset-*) so the player clears the home bar.
  viewportFit: "cover",
  themeColor: "#08080a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
