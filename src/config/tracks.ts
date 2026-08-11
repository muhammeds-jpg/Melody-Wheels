import { SPOTIFY_PLAYLIST_URL } from "./playlist";
import { GENERATED_TRACKS } from "./catalogue.generated";

/**
 * "YT Music" in the top bar, pointing at the songs the site actually plays.
 *
 * `watch_videos` builds a throwaway playlist from a list of video ids and needs
 * no account — so the link lands on exactly this catalogue rather than YouTube's
 * homepage. Set NEXT_PUBLIC_YT_MUSIC_URL to override it with a real YT Music
 * playlist if you keep one.
 *
 * Capped at 50: beyond that YouTube starts dropping ids from the end silently.
 */
function ytMusicUrl(): string {
  const ids = GENERATED_TRACKS.map((t) => t.youtubeId)
    .filter((id): id is string => Boolean(id))
    .slice(0, 50);
  if (ids.length === 0) return "https://music.youtube.com/";
  return `https://www.youtube.com/watch_videos?video_ids=${ids.join(",")}`;
}

export const SITE = {
  name: "Pattu Vandi",
  // Used for the tab title, the PWA manifest, and the social card.
  title: "Pattu Vandi — Music for the journey",
  description:
    "A music player that happens to be a website. One screen, one song at a time, and a way straight into Spotify.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000",
  twitter: "@pattuvandi",

  // §9 — both links open the exact playlist the site plays, never a homepage.
  // Neither needs an API: they are only URLs.
  spotify: process.env.NEXT_PUBLIC_SPOTIFY_URL ?? SPOTIFY_PLAYLIST_URL,
  ytMusic: process.env.NEXT_PUBLIC_YT_MUSIC_URL ?? ytMusicUrl(),
} as const;
