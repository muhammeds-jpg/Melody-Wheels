import { SPOTIFY_PLAYLIST_URL } from "./playlist";

export const SITE = {
  name: "Melody Wheels",
  /** Two lines, stacked in the hero. */
  wordmark: ["Melody", "Wheels"] as const,
  // §34 — final copy to be decided during branding.
  title: "Melody Wheels — Music for the journey",
  description:
    "A music player that happens to be a website. One screen, one song at a time, and a way straight into Spotify.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000",
  twitter: "@melodywheels",

  // §9 — the Spotify link opens the exact playlist the site plays, never a
  // homepage. Works with no API access, since it is only a URL.
  spotify: process.env.NEXT_PUBLIC_SPOTIFY_URL ?? SPOTIFY_PLAYLIST_URL,
  ytMusic: process.env.NEXT_PUBLIC_YT_MUSIC_URL ?? "https://music.youtube.com/",
} as const;
