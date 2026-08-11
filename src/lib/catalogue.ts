/**
 * SERVER ONLY. The list of songs the player runs on.
 *
 * NO CREDENTIALS. There is no client id, no secret, no OAuth and no API key
 * anywhere in this path — which is the whole point: a visitor opens the site and
 * hears music, with nothing to sign in to.
 *
 * Resolution order:
 *
 *  1. `catalogue.generated.ts` — written by `npm run sync`, committed, and the
 *     normal answer. It carries a YouTube video id per track, which is what
 *     makes FULL-LENGTH playback possible for everyone. Serving it costs no
 *     network call at all, so the player is ready as fast as the page.
 *  2. A live read of Spotify's public embed payload, used only when the
 *     configured playlist no longer matches what was baked. It keeps the site
 *     honest — showing the playlist actually configured rather than a stale one
 *     — but it has no YouTube ids, so those tracks fall back to 30s previews
 *     until `npm run sync` is run again.
 */
import type { Track } from "./types";
import { SPOTIFY_PLAYLIST_ID, SPOTIFY_PLAYLIST_URL } from "@/config/playlist";
import {
  GENERATED_PLAYLIST_ID,
  GENERATED_PLAYLIST_NAME,
  GENERATED_TRACKS,
} from "@/config/catalogue.generated";

export type CatalogueSource = "generated" | "live";

export type Catalogue = {
  tracks: Track[];
  source: CatalogueSource;
  playlistName: string | null;
  playlistUrl: string;
  /** How many tracks will play in full, as opposed to a 30-second preview. */
  fullTrackCount: number;
  /** Set when the baked list is stale or a live read failed. */
  warning: string | null;
};

let cached: Catalogue | null = null;
let inFlight: Promise<Catalogue> | null = null;

/* ── the live fallback ───────────────────────────────────────────────────── */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

type EmbedTrack = {
  uri?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
  audioPreview?: { url?: string };
};

/** Depth-first search for the node holding the track list. */
function findTrackList(node: unknown): { name?: string; trackList: EmbedTrack[] } | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const v of node) {
      const hit = findTrackList(v);
      if (hit) return hit;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.trackList)) {
    return { name: typeof obj.name === "string" ? obj.name : undefined, trackList: obj.trackList };
  }
  for (const v of Object.values(obj)) {
    const hit = findTrackList(v);
    if (hit) return hit;
  }
  return null;
}

/**
 * Reads a PUBLIC playlist with no authentication.
 *
 * Spotify's embed page ships its own data as JSON, including each track's real
 * duration and a preview mp3 — both of which the official Web API withholds
 * without a user token.
 */
async function fromEmbed(): Promise<{ name: string | null; tracks: Track[] }> {
  const res = await fetch(`https://open.spotify.com/embed/playlist/${SPOTIFY_PLAYLIST_ID}`, {
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Spotify embed returned ${res.status}`);

  const html = await res.text();
  // [\s\S] rather than the `s` (dotAll) flag: this project's tsconfig targets a
  // version that predates it, and the blob spans newlines.
  const blob = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/,
  );
  if (!blob) throw new Error("Spotify's embed page did not include its data blob.");

  const found = findTrackList(JSON.parse(blob[1]) as unknown);
  if (!found) throw new Error("No track list in the embed payload — is the playlist public?");

  const tracks: Track[] = found.trackList
    .filter((t): t is EmbedTrack & { uri: string } =>
      Boolean(t?.uri?.startsWith("spotify:track:")),
    )
    .map((t) => {
      const id = t.uri.replace("spotify:track:", "");
      return {
        id,
        name: String(t.title ?? "Unknown track"),
        artist: String(t.subtitle ?? ""),
        album: "",
        image: "",
        duration: Number(t.duration ?? 0),
        spotifyUrl: `https://open.spotify.com/track/${id}`,
        uri: t.uri,
        ...(t.audioPreview?.url ? { previewUrl: t.audioPreview.url } : {}),
      };
    });

  return { name: found.name ?? null, tracks };
}

/* ── resolution ──────────────────────────────────────────────────────────── */

async function resolve(): Promise<Catalogue> {
  const baked = GENERATED_TRACKS.length > 0 && GENERATED_PLAYLIST_ID === SPOTIFY_PLAYLIST_ID;

  if (baked) {
    return {
      tracks: GENERATED_TRACKS,
      source: "generated",
      playlistName: GENERATED_PLAYLIST_NAME || null,
      playlistUrl: SPOTIFY_PLAYLIST_URL,
      fullTrackCount: GENERATED_TRACKS.filter((t) => t.youtubeId).length,
      warning: null,
    };
  }

  // The configured playlist is not the one that was baked. Read it live so the
  // site shows the right songs, and say plainly why they are previews.
  const stale =
    GENERATED_TRACKS.length > 0
      ? `Playlist changed to ${SPOTIFY_PLAYLIST_ID} but the catalogue was built for ${GENERATED_PLAYLIST_ID}. Run \`npm run sync\` for full-length playback.`
      : `No catalogue has been built yet. Run \`npm run sync\` for full-length playback.`;

  try {
    const live = await fromEmbed();
    return {
      tracks: live.tracks,
      source: "live",
      playlistName: live.name,
      playlistUrl: SPOTIFY_PLAYLIST_URL,
      fullTrackCount: 0,
      warning: stale,
    };
  } catch (err) {
    // Last resort: the baked list, even though it is the wrong playlist. Some
    // music beats an empty player, and the warning says what happened.
    if (GENERATED_TRACKS.length > 0) {
      return {
        tracks: GENERATED_TRACKS,
        source: "generated",
        playlistName: GENERATED_PLAYLIST_NAME || null,
        playlistUrl: SPOTIFY_PLAYLIST_URL,
        fullTrackCount: GENERATED_TRACKS.filter((t) => t.youtubeId).length,
        warning: `${stale} (Reading it live also failed: ${
          err instanceof Error ? err.message : "unknown error"
        })`,
      };
    }
    throw err;
  }
}

/** Cached in module memory: the playlist rarely changes within a deploy. */
export async function getCatalogue(): Promise<Catalogue> {
  if (cached) return cached;

  inFlight ??= resolve()
    .then((result) => {
      if (result.tracks.length > 0) cached = result;
      return result;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
