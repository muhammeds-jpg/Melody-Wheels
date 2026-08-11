/**
 * SERVER ONLY. §30 — the client secret must never reach the browser. Nothing in
 * this module may be imported from a "use client" file; it is used exclusively
 * by route handlers.
 *
 * Two different Spotify tokens are in play, and conflating them is the usual
 * way this goes wrong:
 *
 *  - **App token** (client credentials). Identifies the app, not a person.
 *    Used for catalogue metadata (§11). No user, no Premium, no consent.
 *  - **User token** (authorization code + secret). Identifies the listener and
 *    carries the `streaming` scope the Web Playback SDK needs (§12, §15).
 *    Premium only.
 */
import type { Track } from "./types";

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

/**
 * Every scope full playback actually needs. Getting this list short is the
 * classic way to end up "connected" but unable to play anything:
 *
 *  - `streaming`                  the Web Playback SDK itself. Premium only.
 *  - `user-read-email` /
 *    `user-read-private`          required alongside streaming; also how we can
 *                                 tell a Premium account from a free one.
 *  - `user-modify-playback-state` PUT /v1/me/player/play. WITHOUT THIS the SDK
 *                                 registers a device and then refuses every
 *                                 command — the failure looks like silence, not
 *                                 an error.
 *  - `user-read-playback-state`   reading back what is playing.
 *  - `playlist-read-private`      /v1/playlists/{id}/items now needs a user
 *                                 token even for a public list.
 */
export const USER_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
  "user-read-playback-state",
  "playlist-read-private",
].join(" ");

export function spotifyConfig() {
  const clientId = process.env.SPOTIFY_CLIENT_ID ?? "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI ?? "";
  return {
    clientId,
    clientSecret,
    redirectUri,
    configured: Boolean(clientId && clientSecret && redirectUri),
  };
}

function basicAuth(): string {
  const { clientId, clientSecret } = spotifyConfig();
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth()}`,
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    // §30 — never log the response body; it carries tokens.
    throw new Error(`spotify token request failed: ${res.status}`);
  }
  return res.json() as Promise<{
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
  }>;
}

/* ── App token (client credentials) ──────────────────────────────────────── */

let appToken: { value: string; expiresAt: number } | null = null;
let appTokenInFlight: Promise<string> | null = null;

/**
 * Cached in module memory. §29 asks for centralized, reused Spotify calls —
 * without the cache every metadata request would also mint a token.
 */
export async function getAppToken(): Promise<string> {
  if (appToken && Date.now() < appToken.expiresAt - 60_000) return appToken.value;

  appTokenInFlight ??= tokenRequest({ grant_type: "client_credentials" })
    .then((json) => {
      appToken = {
        value: json.access_token,
        expiresAt: Date.now() + json.expires_in * 1000,
      };
      return json.access_token;
    })
    .finally(() => {
      appTokenInFlight = null;
    });

  return appTokenInFlight;
}

/* ── User token (authorization code) ─────────────────────────────────────── */

export async function exchangeCode(code: string) {
  const { redirectUri } = spotifyConfig();
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
}

export async function refreshUserToken(refreshToken: string) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

/* ── Catalogue ───────────────────────────────────────────────────────────── */

type SpotifyApiTrack = {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  is_playable?: boolean;
  external_urls: { spotify: string };
  artists: { name: string }[];
  album: { name: string; images: { url: string; width: number; height: number }[] };
};

/** §31 — one normalized shape, so the frontend never sees Spotify's raw payload. */
export function normalizeTrack(t: SpotifyApiTrack): Track {
  const image =
    t.album.images.find((i) => i.width === 640)?.url ?? t.album.images[0]?.url ?? "";
  return {
    id: t.id,
    name: t.name,
    artist: t.artists.map((a) => a.name).join(", "),
    album: t.album.name,
    image,
    duration: t.duration_ms,
    spotifyUrl: t.external_urls.spotify,
    uri: t.uri,
    ...(typeof t.is_playable === "boolean" ? { isPlayable: t.is_playable } : {}),
  };
}

/**
 * §29 — metadata for a fixed catalogue never changes within a deploy, so it is
 * cached in memory and the several-tracks case is served by ONE `/v1/tracks`
 * call rather than N `/v1/tracks/{id}` calls.
 */
const trackCache = new Map<string, Track>();

export async function getTracks(ids: readonly string[]): Promise<Track[]> {
  const missing = ids.filter((id) => !trackCache.has(id));

  if (missing.length > 0) {
    const token = await getAppToken();
    // /v1/tracks accepts up to 50 ids per request.
    for (let i = 0; i < missing.length; i += 50) {
      const batch = missing.slice(i, i + 50);
      const res = await fetch(`${API}/tracks?ids=${batch.join(",")}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`spotify /tracks failed: ${res.status}`);
      const json = (await res.json()) as { tracks: (SpotifyApiTrack | null)[] };
      for (const t of json.tracks) {
        if (t) trackCache.set(t.id, normalizeTrack(t));
      }
    }
  }

  // Unavailable ids simply drop out rather than leaving holes in the playlist.
  return ids.map((id) => trackCache.get(id)).filter((t): t is Track => Boolean(t));
}

export async function getTrack(id: string): Promise<Track | null> {
  const cached = trackCache.get(id);
  if (cached) return cached;

  const token = await getAppToken();
  const res = await fetch(`${API}/tracks/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`spotify /tracks/${id} failed: ${res.status}`);

  const track = normalizeTrack((await res.json()) as SpotifyApiTrack);
  trackCache.set(track.id, track);
  return track;
}

/** §12 — the SDK needs Premium; knowing early gives a better error than the SDK's. */
export async function getUserProduct(accessToken: string): Promise<string | null> {
  const res = await fetch(`${API}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { product?: string };
  return json.product ?? null;
}
