"use server";

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { refreshUserToken } from "@/lib/spotify-server";

/**
 * Switch the site to a playlist, and rebuild the seed list from it.
 *
 * This lives in a server action rather than the CLI script for one reason: the
 * Spotify session is an httpOnly cookie. Only a request from the browser
 * carries it, so only this path can read a PRIVATE playlist's contents. A
 * terminal script has no cookie jar and always looks signed out.
 *
 * Development only — it rewrites files under src/, which must never happen on a
 * deployed server.
 */
export type SwitchResult = { ok: boolean; message: string };

const ROOT = process.cwd();
const ENV = join(ROOT, ".env.local");
const CONFIG = join(ROOT, "src", "config", "playlist.ts");

type ApiTrack = {
  id: string;
  name: string;
  type?: string;
  artists: { name: string }[];
};

export async function usePlaylist(
  _prev: SwitchResult | null,
  formData: FormData,
): Promise<SwitchResult> {
  if (process.env.NODE_ENV !== "development") {
    return { ok: false, message: "Only available in development." };
  }

  const id = String(formData.get("id") ?? "");
  if (!/^[A-Za-z0-9]{10,}$/.test(id)) {
    return { ok: false, message: "That doesn't look like a playlist id." };
  }

  const refresh = (await cookies()).get("mw_refresh")?.value;
  if (!refresh) {
    return { ok: false, message: "Not connected to Spotify in this browser." };
  }

  let token: string;
  try {
    token = (await refreshUserToken(refresh)).access_token;
  } catch {
    return { ok: false, message: "Spotify session expired — connect again." };
  }

  // Read the playlist with the USER's token; a private list needs it.
  const collected: { spotifyId: string; search: string }[] = [];
  let endpoint: string | null = `https://api.spotify.com/v1/playlists/${id}/items?limit=50`;

  while (endpoint) {
    const res: Response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, message: `Spotify returned ${res.status} reading that playlist.` };
    }
    const page = (await res.json()) as {
      items?: { item?: ApiTrack | null; track?: ApiTrack | null; is_local?: boolean }[];
      next?: string | null;
    };

    for (const row of page.items ?? []) {
      const t = row.item ?? row.track;
      if (!t?.id || row.is_local || (t.type && t.type !== "track")) continue;
      // Trim to title + primary artist, or the iTunes preview lookup misses.
      const title = t.name
        .split(/\s[-–—]\s/)[0]
        .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const primary = (t.artists[0]?.name ?? "").trim();
      collected.push({ spotifyId: t.id, search: `${title} ${primary}`.trim().slice(0, 90) });
    }
    endpoint = page.next ?? null;
  }

  if (collected.length === 0) {
    return { ok: false, message: "That playlist has no playable tracks." };
  }

  // 1. Point the site at it.
  let env = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
  const line = `NEXT_PUBLIC_SPOTIFY_PLAYLIST_ID=${id}`;
  env = /^NEXT_PUBLIC_SPOTIFY_PLAYLIST_ID=.*$/m.test(env)
    ? env.replace(/^NEXT_PUBLIC_SPOTIFY_PLAYLIST_ID=.*$/m, line)
    : `${env.trimEnd()}\n\n# The playlist the site plays.\n${line}\n`;
  writeFileSync(ENV, env, "utf8");

  // 2. Rebuild what anonymous visitors see.
  const config = readFileSync(CONFIG, "utf8");
  const rendered = collected
    .map(
      (t) =>
        `  { spotifyId: ${JSON.stringify(t.spotifyId)}, search: ${JSON.stringify(t.search)} },`,
    )
    .join("\n");

  const updated = config.replace(
    /export const SEED_TRACKS: SeedEntry\[\] = \[[\s\S]*?\n\];/,
    `export const SEED_TRACKS: SeedEntry[] = [\n${rendered}\n];`,
  );

  if (updated === config) {
    return { ok: false, message: "Set the playlist, but could not rewrite SEED_TRACKS." };
  }
  writeFileSync(CONFIG, updated, "utf8");

  revalidatePath("/playlists");
  return {
    ok: true,
    message: `Switched, and rebuilt the seed from its ${collected.length} tracks. Restart the dev server.`,
  };
}
