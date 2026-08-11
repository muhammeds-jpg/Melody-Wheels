/**
 * Point the site at a different Spotify playlist.
 *
 *   npm run set:playlist https://open.spotify.com/playlist/xxxxxxxx
 *   npm run set:playlist spotify:playlist:xxxxxxxx
 *   npm run set:playlist xxxxxxxx
 *   npm run set:playlist            # lists the connected account's playlists
 *
 * It does three things:
 *   1. confirms the playlist exists and prints its name (public oEmbed, no auth)
 *   2. writes NEXT_PUBLIC_SPOTIFY_PLAYLIST_ID into .env.local
 *   3. regenerates SEED_TRACKS from the real playlist, if the dev server has a
 *      connected Spotify session — an app token cannot read playlist items
 *      (401 "Valid user authentication required"), so this step needs one.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = join(ROOT, ".env.local");
const CONFIG = join(ROOT, "src", "config", "playlist.ts");
const SITE = process.env.SITE_URL ?? "http://127.0.0.1:3000";

function parseId(input) {
  const t = input.trim();
  return (
    t.match(/playlist\/([A-Za-z0-9]+)/)?.[1] ??
    t.match(/spotify:playlist:([A-Za-z0-9]+)/)?.[1] ??
    t
  );
}

/**
 * A token from the running site.
 *
 * NOTE: this only works if a SPOTIFY_USER_TOKEN is supplied, because the
 * session lives in an httpOnly cookie that only the browser holds. Node has no
 * cookie jar, so calling /api/spotify/token from here always looks signed-out.
 * Listing playlists is therefore done in the browser, at /playlists.
 */
async function siteUserToken() {
  if (process.env.SPOTIFY_USER_TOKEN) return process.env.SPOTIFY_USER_TOKEN;
  try {
    const r = await fetch(`${SITE}/api/spotify/token`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()).accessToken ?? null;
  } catch {
    return null;
  }
}

const input = process.argv[2];

if (!input) {
  console.log(`
Usage:  npm run set:playlist <playlist url, uri, or id>

To find the id, open this page in the browser you connected Spotify in:

    ${SITE}/playlists

It lists every playlist on the account with a ready-to-copy command for each.
(The session is a browser cookie, so it cannot be read from the terminal.)
`);
  process.exit(1);
}

/* ── 1. Confirm the playlist ─────────────────────────────────────────────── */
const id = parseId(input);
if (!/^[A-Za-z0-9]{10,}$/.test(id)) {
  console.error(`"${input}" does not look like a playlist id, url or uri.`);
  process.exit(1);
}

const url = `https://open.spotify.com/playlist/${id}`;
let name = null;
try {
  const oe = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
  if (oe.ok) name = (await oe.json()).title ?? null;
} catch {
  /* offline — not fatal */
}

if (!name) {
  console.log(`Warning: could not confirm that playlist ${id} exists or is public.`);
  console.log(`         Continuing anyway — check the name on the site afterwards.\n`);
} else {
  console.log(`\nPlaylist: "${name}"`);
  console.log(`   ${url}\n`);
}

/* ── 2. Write the id into .env.local ─────────────────────────────────────── */
let env = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
const line = `NEXT_PUBLIC_SPOTIFY_PLAYLIST_ID=${id}`;

if (/^NEXT_PUBLIC_SPOTIFY_PLAYLIST_ID=.*$/m.test(env)) {
  env = env.replace(/^NEXT_PUBLIC_SPOTIFY_PLAYLIST_ID=.*$/m, line);
} else {
  env = env.trimEnd() + `\n\n# The playlist the site plays. Set by scripts/set-playlist.mjs.\n${line}\n`;
}
writeFileSync(ENV, env, "utf8");
console.log(`  ok    .env.local -> ${line}`);

/* ── 3. Regenerate the seed from the real playlist ───────────────────────── */
const token = await siteUserToken();
if (!token) {
  console.log(`
  note  SEED_TRACKS was NOT regenerated.

        Reading a playlist's items needs a user token, and the session is a
        browser cookie this script cannot read. Connected visitors already see
        the new playlist; anonymous ones keep the old seed list until it is
        refreshed.

        To refresh it, grab a token from ${SITE}/api/spotify/token
        in the connected browser and re-run:

          SPOTIFY_USER_TOKEN=<paste> npm run set:playlist ${id}
`);
  process.exit(0);
}

const collected = [];
let endpoint = `https://api.spotify.com/v1/playlists/${id}/items?limit=50`;
while (endpoint) {
  const r = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    console.log(`  note  could not read the playlist's items (${r.status}); seed left unchanged.`);
    process.exit(0);
  }
  const page = await r.json();
  for (const row of page.items ?? []) {
    const t = row.item ?? row.track;
    if (!t || row.is_local || (t.type && t.type !== "track")) continue;
    collected.push({
      spotifyId: t.id,
      search: `${t.name} ${t.artists.map((a) => a.name).join(" ")}`.slice(0, 90),
    });
  }
  endpoint = page.next ?? null;
}

if (collected.length === 0) {
  console.log("  note  the playlist appears to be empty; seed left unchanged.");
  process.exit(0);
}

const config = readFileSync(CONFIG, "utf8");
const rendered = collected
  .map((t) => `  { spotifyId: ${JSON.stringify(t.spotifyId)}, search: ${JSON.stringify(t.search)} },`)
  .join("\n");

const updated = config.replace(
  /export const SEED_TRACKS: SeedEntry\[\] = \[[\s\S]*?\n\];/,
  `export const SEED_TRACKS: SeedEntry[] = [\n${rendered}\n];`,
);

if (updated === config) {
  console.log("  note  could not locate SEED_TRACKS to rewrite; edit it by hand.");
  process.exit(1);
}

writeFileSync(CONFIG, updated, "utf8");
console.log(`  ok    SEED_TRACKS regenerated from the playlist (${collected.length} tracks)`);
for (const t of collected.slice(0, 12)) console.log(`          ${t.search}`);
if (collected.length > 12) console.log(`          … and ${collected.length - 12} more`);

console.log(`\nRestart the dev server for the change to take effect.\n`);
