/**
 * Preflight for local setup: says exactly what is missing and what to do,
 * instead of leaving you to infer it from a 503.
 *
 *   npm run check:env
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, ".env.local");

const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => console.log(`  MISS  ${m}`);
const warn = (m) => console.log(`  warn  ${m}`);

if (!existsSync(FILE)) {
  console.log("\n.env.local does not exist.\n");
  console.log("  cp .env.example .env.local   (then fill in the two blanks)\n");
  process.exit(1);
}

// Minimal dotenv parse — no dependency needed for KEY=value lines.
const env = {};
for (const line of readFileSync(FILE, "utf8").split(/\r?\n/)) {
  if (!line.trim() || line.trim().startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq === -1) continue;
  env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}

console.log("\nChecking .env.local\n");

let missing = 0;

for (const key of ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"]) {
  if (env[key]) ok(`${key} is set (${env[key].length} chars)`);
  else {
    bad(`${key} is empty`);
    missing++;
  }
}

/**
 * Spotify's rules, as documented:
 *   "Use HTTPS for your redirect URI, unless you are using a loopback address,
 *    when HTTP is permitted. If you are using a loopback address, use the
 *    explicit IPv4 or IPv6, like http://127.0.0.1:PORT ... localhost is not
 *    allowed as redirect URI."
 * Enforced for apps created after 9 April 2025, so a `localhost` value is
 * rejected outright rather than merely being a mismatch.
 */
const redirect = env.SPOTIFY_REDIRECT_URI ?? "";
if (!redirect) {
  bad("SPOTIFY_REDIRECT_URI is empty");
  missing++;
} else {
  const isLocalhost = /^https?:\/\/localhost(:|\/|$)/i.test(redirect);
  const isLoopback = /^http:\/\/(127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(redirect);
  const isHttps = /^https:\/\//i.test(redirect);

  if (isLocalhost) {
    bad(`SPOTIFY_REDIRECT_URI uses localhost — Spotify rejects it outright`);
    warn("  use http://127.0.0.1:3000/auth/spotify/callback instead");
    missing++;
  } else if (!isLoopback && !isHttps) {
    bad(`SPOTIFY_REDIRECT_URI must be https, or an explicit loopback IP`);
    warn("  valid: https://you.com/... , http://127.0.0.1:3000/... , http://[::1]:3000/...");
    missing++;
  } else {
    ok(`SPOTIFY_REDIRECT_URI = ${redirect}`);
  }

  if (!redirect.endsWith("/auth/spotify/callback")) {
    warn("  it must end with /auth/spotify/callback to match the route in this app");
  }
}

console.log("");

if (missing > 0) {
  console.log(`${missing} value(s) still needed.\n`);
  console.log("  1. https://developer.spotify.com/dashboard  ->  create an app");
  console.log("  2. copy its Client ID and Client Secret into .env.local");
  console.log(`  3. add this Redirect URI to the app, byte for byte:`);
  console.log(`       ${redirect || "http://127.0.0.1:3000/auth/spotify/callback"}`);
  console.log("  4. restart `npm run dev` — env files are only read at startup\n");
  process.exit(1);
}

console.log("Ready. Restart `npm run dev` and open http://127.0.0.1:3000\n");
console.log("Reminder: full-track playback needs the account you log in with to be");
console.log("Spotify Premium. Free accounts get account_error from the SDK, and the");
console.log("dashboard now gates Web API access behind Premium too.\n");
