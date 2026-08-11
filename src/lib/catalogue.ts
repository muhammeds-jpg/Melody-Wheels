/**
 * SERVER ONLY. Turns the owner's Spotify playlist into playable tracks.
 *
 * The playlist is the source of truth. Resolution order:
 *
 *  1. `GET /v1/playlists/{id}/items` for the track list. This is the endpoint —
 *     `/tracks` is retired, and each entry wraps its track under `item`.
 *  2. iTunes Search for each track, because Spotify's API returns NO audio URL
 *     of any kind (`preview_url` is absent from the track object entirely). The
 *     30s preview is what actually makes a sound.
 *  3. If step 1 is refused — currently a blanket 403, "Active premium
 *     subscription required for the owner of the app" — fall back to the seed
 *     list, which mirrors the same playlist.
 *
 * Cached in module memory: the playlist rarely changes and re-resolving per
 * request would only burn rate limit.
 */
import type { Track } from "./types";
import {
  SEED_TRACKS,
  SPOTIFY_PLAYLIST_ID,
  SPOTIFY_PLAYLIST_URL,
  type SeedEntry,
} from "@/config/playlist";
import { getAppToken, spotifyConfig } from "./spotify-server";

export type CatalogueSource = "playlist" | "seed";

export type Catalogue = {
  tracks: Track[];
  source: CatalogueSource;
  playlistName: string | null;
  playlistUrl: string;
  /** Why the playlist could not be read, when it could not be. */
  spotifyError: string | null;
};

let cached: Catalogue | null = null;
let inFlight: Promise<Catalogue> | null = null;

/* ── Playlist name, with no auth ─────────────────────────────────────────── */

/** oEmbed is public and needs no credentials, so the name works even at 403. */
async function playlistName(): Promise<string | null> {
  try {
    const res = await fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(SPOTIFY_PLAYLIST_URL)}`,
      { cache: "no-store", signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { title?: string };
    return json.title ?? null;
  } catch {
    return null;
  }
}

/* ── Playlist contents ───────────────────────────────────────────────────── */

type SpotifyApiTrack = {
  id: string;
  name: string;
  uri: string;
  type?: string;
  duration_ms: number;
  external_urls: { spotify: string };
  artists: { name: string }[];
  album: { name: string; images: { url: string; width: number; height: number }[] };
};

type PlaylistPage = {
  items?: ({ item?: SpotifyApiTrack | null; track?: SpotifyApiTrack | null; is_local?: boolean })[];
  next?: string | null;
};

function toTrack(t: SpotifyApiTrack): Track {
  const image = t.album.images.find((i) => i.width === 640)?.url ?? t.album.images[0]?.url ?? "";
  return {
    id: t.id,
    name: t.name,
    artist: t.artists.map((a) => a.name).join(", "),
    album: t.album.name,
    image,
    duration: t.duration_ms,
    spotifyUrl: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id}`,
    uri: t.uri,
  };
}

/**
 * Reading playlist CONTENTS now answers 401 "Valid user authentication
 * required" for an app token, even on a public playlist — so a user token is
 * passed in when the visitor has connected Spotify. Without one we fall back to
 * the seed list.
 */
async function fromPlaylist(
  userToken?: string,
): Promise<{ tracks: Track[]; error: string | null }> {
  if (!spotifyConfig().configured) {
    return { tracks: [], error: "Spotify credentials are not configured." };
  }

  try {
    const token = userToken ?? (await getAppToken());
    const collected: Track[] = [];
    let endpoint: string | null = `https://api.spotify.com/v1/playlists/${SPOTIFY_PLAYLIST_ID}/items?limit=50`;

    while (endpoint) {
      const res: Response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        let message = "";
        try {
          message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? "";
        } catch {
          /* non-JSON */
        }
        if (!message) {
          message =
            res.status === 401
              ? "Reading the playlist needs a connected Spotify account."
              : res.status === 403
                ? "Spotify returned 403 — the app may lack Web API access."
                : res.status === 429
                  ? `Spotify returned 429 (rate limited); retry-after ${res.headers.get("retry-after") ?? "?"}s.`
                  : `Spotify returned ${res.status}.`;
        }
        return { tracks: [], error: message };
      }

      const page = (await res.json()) as PlaylistPage;
      for (const row of page.items ?? []) {
        // `item` is the current wrapper; `track` is tolerated for older payloads.
        const t = row.item ?? row.track;
        // Playlists can hold podcast episodes and local files; neither is playable here.
        if (!t || row.is_local || (t.type && t.type !== "track")) continue;
        collected.push(toTrack(t));
      }
      endpoint = page.next ?? null;
    }

    return { tracks: collected, error: null };
  } catch (err) {
    return { tracks: [], error: err instanceof Error ? err.message : "Spotify request failed." };
  }
}

/* ── Audible audio, via iTunes ───────────────────────────────────────────── */

const durationCache = new Map<string, number>();

async function previewDurationMs(url: string): Promise<number> {
  const known = durationCache.get(url);
  if (known) return known;
  try {
    const res = await fetch(url, { headers: { range: "bytes=0-65535" } });
    if (!res.ok && res.status !== 206) return 30_000;
    const buf = Buffer.from(await res.arrayBuffer());
    const idx = buf.indexOf(Buffer.from("mvhd", "ascii"));
    if (idx === -1) return 30_000;
    const version = buf[idx + 4];
    const timescale = version === 0 ? buf.readUInt32BE(idx + 16) : buf.readUInt32BE(idx + 24);
    const duration =
      version === 0 ? buf.readUInt32BE(idx + 20) : Number(buf.readBigUInt64BE(idx + 28));
    const ms = timescale ? Math.round((duration / timescale) * 1000) : 30_000;
    durationCache.set(url, ms);
    return ms;
  } catch {
    return 30_000;
  }
}

type ItunesResult = {
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
};

/**
 * Builds a search term iTunes can actually match.
 *
 * Feeding Spotify's full metadata in verbatim makes the query WORSE: a title
 * like "Amsham - അംശം" with four comma-separated artists matches nothing, and
 * the track silently loses its preview. So trim to the parts that identify the
 * recording — the main title and the primary artist.
 */
function searchTermFor(name: string, artist: string): string {
  const title = name
    .split(/\s[-–—]\s/)[0] // drop subtitles and transliterations
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ") // (feat. X), [Remastered]
    .replace(/\s+/g, " ")
    .trim();

  const primary = artist.split(/,|&|feat\.|ft\./i)[0].trim();

  return `${title} ${primary}`.trim().slice(0, 90);
}

/** Finds the audible preview for a track we already know the name of. */
async function findPreview(term: string): Promise<Partial<Track> | null> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=1`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const s = ((await res.json()) as { results?: ItunesResult[] }).results?.[0];
    if (!s?.previewUrl) return null;

    return {
      name: s.trackName,
      artist: s.artistName,
      album: s.collectionName ?? "",
      image: (s.artworkUrl100 ?? "").replace("100x100bb", "600x600bb"),
      previewUrl: s.previewUrl,
      duration: await previewDurationMs(s.previewUrl),
    };
  } catch {
    return null;
  }
}

/* ── Resolution ──────────────────────────────────────────────────────────── */

async function resolve(userToken?: string): Promise<Catalogue> {
  const [name, playlist] = await Promise.all([playlistName(), fromPlaylist(userToken)]);

  const usingPlaylist = playlist.tracks.length > 0;

  // Either way we end up with a list of (spotify identity, search term) pairs.
  const entries: { base: Partial<Track>; entry: SeedEntry }[] = usingPlaylist
    ? playlist.tracks.map((t) => ({
        base: t,
        entry: { spotifyId: t.id, search: searchTermFor(t.name, t.artist) },
      }))
    : SEED_TRACKS.map((e) => ({ base: {}, entry: e }));

  const resolved = await Promise.all(
    entries.map(async ({ base, entry }) => {
      const preview = await findPreview(entry.search);
      if (!base.name && !preview) return null;

      const previewUrl = preview?.previewUrl ?? "";
      const track: Track = {
        id: entry.spotifyId,
        // Spotify's metadata wins when we have it; iTunes fills the gaps.
        name: base.name ?? preview?.name ?? "Unknown track",
        artist: base.artist ?? preview?.artist ?? "",
        album: base.album ?? preview?.album ?? "",
        image: base.image || preview?.image || "",
        // Preview length for preview mode...
        duration: previewUrl ? (preview?.duration ?? 30_000) : (base.duration ?? 0),
        // ...and the real track length for when the SDK is streaming it.
        ...(base.duration ? { fullDuration: base.duration } : {}),
        spotifyUrl: `https://open.spotify.com/track/${entry.spotifyId}`,
        uri: base.uri ?? `spotify:track:${entry.spotifyId}`,
        ...(previewUrl ? { previewUrl } : {}),
      };
      return track;
    }),
  );

  return {
    tracks: resolved.filter((t): t is Track => t !== null),
    source: usingPlaylist ? "playlist" : "seed",
    playlistName: name,
    playlistUrl: SPOTIFY_PLAYLIST_URL,
    spotifyError: playlist.error,
  };
}

/**
 * @param userToken - a connected visitor's access token. Only then can the
 *   playlist's contents be read; without one the seed list is used.
 *
 * The cache is only *upgraded*: once the real playlist has been read it is kept
 * for everyone, since its contents are the same public list regardless of who
 * asked. A seed-sourced result never overwrites a playlist-sourced one.
 */
export async function getCatalogue(userToken?: string): Promise<Catalogue> {
  if (cached?.source === "playlist") return cached;
  if (cached && !userToken) return cached;

  inFlight ??= resolve(userToken)
    .then((result) => {
      if (result.tracks.length > 0 && (!cached || result.source === "playlist")) {
        cached = result;
      }
      return result;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
