/**
 * Preflight: says exactly what is and is not working, and what to do about it.
 *
 *   npm run check:env
 *
 * Nothing this app needs is a credential, so this checks the things that
 * actually break the site: whether the playlist is readable, and whether the
 * baked catalogue still matches it.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => console.log(`  BAD   ${m}`);
const warn = (m) => console.log(`  warn  ${m}`);
const info = (m) => console.log(`        ${m}`);

/* ── what is configured ──────────────────────────────────────────────────── */

const env = {};
const ENV_FILE = join(ROOT, ".env.local");
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
}

const configuredId = env.NEXT_PUBLIC_SPOTIFY_PLAYLIST_ID ?? "";
let problems = 0;

console.log("\nMelody Wheels — preflight\n");
console.log("The playlist");

if (!configuredId) {
  // Not a problem: playlist.ts defaults to whatever `npm run sync` baked, which
  // is exactly what happens on a host where .env.local does not exist.
  info("NEXT_PUBLIC_SPOTIFY_PLAYLIST_ID not set — using the baked playlist, as production does");
} else {
  ok(`playlist ${configuredId}`);
}

/* ── the baked catalogue ─────────────────────────────────────────────────── */

console.log("\nThe catalogue");

/** Hoisted: the reachability check below falls back to it, as the app does. */
let bakedPlaylistId = "";

const GEN = join(ROOT, "src", "config", "catalogue.generated.ts");
if (!existsSync(GEN)) {
  bad("catalogue.generated.ts is missing");
  info("run: npm run sync");
  problems++;
} else {
  const body = readFileSync(GEN, "utf8");
  const bakedId = body.match(/GENERATED_PLAYLIST_ID\s*=\s*"([^"]*)"/)?.[1] ?? "";
  bakedPlaylistId = bakedId;
  const bakedName = body.match(/GENERATED_PLAYLIST_NAME\s*=\s*"([^"]*)"/)?.[1] ?? "";
  const total = (body.match(/^\s{2}\{$/gm) ?? []).length;
  const withVideo = (body.match(/youtubeId:/g) ?? []).length;

  ok(`"${bakedName}" — ${total} track${total === 1 ? "" : "s"}`);

  if (configuredId && bakedId && configuredId !== bakedId) {
    bad(`built for ${bakedId}, but ${configuredId} is configured`);
    info("the site will read the playlist live and play 30s previews until you");
    info("run: npm run sync");
    problems++;
  } else if (total === 0) {
    bad("the catalogue is empty");
    info("run: npm run sync");
    problems++;
  } else if (withVideo === total) {
    ok(`all ${total} play FULL LENGTH — no account needed`);
  } else if (withVideo === 0) {
    bad("no track has a YouTube match — everything is a 30-second preview");
    info("run: npm run sync   (and check its output for NO MATCH lines)");
    problems++;
  } else {
    warn(`${withVideo}/${total} play full length; the rest are 30s previews`);
    info("re-run npm run sync to retry the unmatched ones");
  }
}

/* ── can the playlist actually be read right now? ────────────────────────── */

console.log("\nReachability (no credentials used)");

// Falls back to whatever was baked, exactly as src/config/playlist.ts does.
const id = configuredId || bakedPlaylistId || "";
if (!id) {
  bad("no playlist to check — nothing configured and nothing baked");
  process.exit(1);
}
try {
  const res = await fetch(`https://open.spotify.com/embed/playlist/${id}`, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(12_000),
  });
  const html = await res.text();
  const hasList = /"trackList"\s*:\s*\[\s*\{/.test(html);
  if (res.ok && hasList) ok("Spotify's public embed answers with the track list");
  else if (res.ok) {
    bad("Spotify answered, but with no tracks — is the playlist PUBLIC?");
    info("open it in a private window; if the songs are not there, nor can we read them");
    problems++;
  } else {
    bad(`Spotify's embed returned ${res.status}`);
    problems++;
  }
} catch (err) {
  warn(`could not reach Spotify: ${err instanceof Error ? err.message : "unknown"}`);
}

try {
  const res = await fetch("https://www.youtube.com/iframe_api", {
    signal: AbortSignal.timeout(12_000),
  });
  if (res.ok) ok("YouTube's IFrame API is reachable");
  else {
    bad(`YouTube's IFrame API returned ${res.status}`);
    problems++;
  }
} catch (err) {
  warn(`could not reach YouTube: ${err instanceof Error ? err.message : "unknown"}`);
}

/* ── optional extras ─────────────────────────────────────────────────────── */

console.log("\nOptional (none of this is needed to play music)");

if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
  ok("Upstash Redis set — the listener count is shared across instances");
} else {
  info("no Upstash Redis — the listener count lives in one server's memory");
}

if (env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET) {
  ok("Spotify app credentials set — a Premium listener can connect the SDK");
  const redirect = env.SPOTIFY_REDIRECT_URI ?? "";
  // Spotify rejects `localhost` outright for apps created after 9 Apr 2025;
  // a loopback IP is required, or https.
  if (/^https?:\/\/localhost(:|\/|$)/i.test(redirect)) {
    warn("SPOTIFY_REDIRECT_URI uses localhost, which Spotify rejects");
    info("use http://127.0.0.1:3000/auth/spotify/callback");
  }
} else {
  info("no Spotify app — the optional Premium SDK path is off, which is fine");
}

if (env.NEXT_PUBLIC_SITE_URL && !/127\.0\.0\.1|localhost/.test(env.NEXT_PUBLIC_SITE_URL)) {
  ok(`NEXT_PUBLIC_SITE_URL = ${env.NEXT_PUBLIC_SITE_URL}`);
} else {
  info("NEXT_PUBLIC_SITE_URL still points at localhost — set it before sharing a link");
}

console.log(
  problems === 0
    ? "\nReady. `npm run dev` and open http://127.0.0.1:3000\n"
    : `\n${problems} thing(s) to fix, listed above.\n`,
);
process.exit(problems === 0 ? 0 : 1);
