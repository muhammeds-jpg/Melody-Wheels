/**
 * The site plays ONE Spotify playlist. Change it and everything follows: the
 * songs, the artwork, and the "Spotify" link in the top bar.
 *
 * To change it:
 *
 *     npm run sync -- https://open.spotify.com/playlist/<id>
 *
 * That one command reads the playlist, finds a YouTube video for every track so
 * it can play at FULL LENGTH with no account, writes the id into `.env.local`,
 * and regenerates `catalogue.generated.ts`. Then restart the dev server.
 *
 * The playlist must be PUBLIC. Nothing here authenticates, by design — that is
 * what lets a visitor arrive and press play with nothing to sign in to.
 */

import { GENERATED_PLAYLIST_ID } from "./catalogue.generated";

/** Accepts a full URL, a spotify: URI, or a bare id. */
export function parsePlaylistId(input: string): string {
  const trimmed = input.trim();
  // https://open.spotify.com/playlist/<id>?si=...
  const url = trimmed.match(/playlist\/([A-Za-z0-9]+)/);
  if (url) return url[1];
  // spotify:playlist:<id>
  const uri = trimmed.match(/spotify:playlist:([A-Za-z0-9]+)/);
  if (uri) return uri[1];
  return trimmed;
}

/**
 * The playlist the site plays. Defaults to whatever was BAKED, not to a
 * hardcoded id.
 *
 * This matters most in production. `.env.local` is gitignored, so
 * NEXT_PUBLIC_SPOTIFY_PLAYLIST_ID does not exist on the host — and a hardcoded
 * default meant the deployed build believed in a different playlist than the one
 * in `catalogue.generated.ts`. `catalogue.ts` spots that disagreement and falls
 * back to reading Spotify live, which carries no YouTube ids, so every track
 * played 30 seconds on the live site while working perfectly on localhost.
 *
 * Deriving the default from the generated file makes the two agree by
 * construction: `npm run sync` is the single act that changes the playlist, and
 * it updates both. The env var still overrides, for a host that wants to point
 * at something else on purpose.
 */
export const SPOTIFY_PLAYLIST_ID = parsePlaylistId(
  process.env.NEXT_PUBLIC_SPOTIFY_PLAYLIST_ID || GENERATED_PLAYLIST_ID,
);

export const SPOTIFY_PLAYLIST_URL = `https://open.spotify.com/playlist/${SPOTIFY_PLAYLIST_ID}`;
