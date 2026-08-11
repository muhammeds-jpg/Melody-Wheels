# Pattu Vandi — Decisions

Where the PRD required a judgement call, and what is genuinely blocking.

---

## 0. Read this first: two launch blockers

### A. Every listener needs Spotify Premium

§12 acknowledges it, and it is worth stating in plain terms: the Web Playback
SDK's `streaming` scope is **Premium only**. A free account gets `account_error`
and cannot play a single second. Pattu Vandi is therefore not a link you can
send to anyone — it is a link you can send to Premium subscribers who are willing
to log in with Spotify.

If that is not the intended audience, the architecture has to change, and §13's
Embed route is the only alternative that removes both the Premium requirement and
the login.

### B. §14 — the commercial-use restriction is unresolved

Spotify's developer terms restrict streaming applications, and the Web Playback
SDK documentation states that streaming applications may not be commercial.
**Nothing in this codebase can resolve that.** It is a policy question about the
intended business model, and per §14 it must be validated against current Spotify
Developer Terms before production launch.

Treat it as blocking. Building further does not make it go away.

---

## 1. "Not iframe" is the Web Playback SDK — and that is what was built

The instruction was to avoid an iframe embed. That is exactly what §12's
preferred option gives: the SDK registers a Spotify Connect device in the browser
and streams into it, while Pattu Vandi draws its own UI. There is no visible
embed and no third-party chrome.

For completeness: the SDK does create a hidden iframe internally as its transport.
That is an implementation detail of Spotify's library, not an embed you style or
that occupies layout, and it is not avoidable by any means short of dropping
Spotify playback entirely.

## 2. Next.js route handlers *are* the Node backend

§16 asks for a Node.js backend and §17 lists Express — but §17 also sanctions
Next.js. Route handlers under `src/app/api` and `src/app/auth` run on Node and
cover every §16 responsibility: Spotify API communication, OAuth exchange, token
refresh, track retrieval, configuration, error handling and env management.

A separate Express process was rejected deliberately: it would mean two
deployables, a CORS surface between them, and cookies that have to be shared
across origins — all of it cost with no capability gained at this size.

## 3. Server-side authorization code flow, not PKCE

§15 and §30 are specific: the **Node backend** exchanges the code, manages tokens,
and the client secret never reaches the browser. So this uses the confidential
client flow with `SPOTIFY_CLIENT_SECRET` server-side — not the browser-side PKCE
flow a single-page app would normally reach for.

Consequences, all of them deliberate:

- The refresh token lives in an **httpOnly cookie**. JavaScript cannot read it,
  so an XSS bug cannot exfiltrate a long-lived credential.
- The browser only ever receives short-lived access tokens, from
  `GET /api/spotify/token`, which the SDK calls again whenever its token expires.
- `SameSite=Lax` on both cookies — required, because the auth cookie has to
  survive the cross-site redirect back from Spotify.

**Verified:** a build with a sentinel secret was scanned across all 27 client JS
chunks and every prerendered HTML file. Neither the secret nor the client ID
appears in any of them.

## 4. Two different Spotify tokens

Conflating these is the usual way this architecture goes wrong:

| | App token | User token |
|---|---|---|
| Grant | client credentials | authorization code |
| Identifies | the app | the listener |
| Used for | catalogue metadata (§11) | Web Playback SDK (§12) |
| Needs a user? | no | yes, and Premium |

So `/api/tracks` and `/api/track/:id` work with no one logged in — the interface
can render the catalogue, artwork and CTAs before any Spotify login. Only pressing
play requires a session. That is what keeps the first paint useful.

## 5. Metadata is fetched once and cached

§29 asks for centralized, reused Spotify calls. `getTracks()` batches the whole
catalogue into **one** `/v1/tracks?ids=…` request rather than N requests, and
caches results in module memory; the app token is cached the same way, so a
metadata request does not also mint a token. `/api/tracks` additionally carries
`revalidate = 300`.

## 6. The player state machine is derived, not manually driven

§19's states live in one `phase` field, but the transport buttons never assign it.
`next()` / `prev()` call the SDK, and the resulting `player_state_changed` is what
moves `index`, `progressMs` and `phase`. One source of truth, so the UI cannot
drift out of step with what is actually playing.

Progress is **polled at 250ms** while playing, because the SDK reports position
only when something changes — there is no `timeupdate`. The poll stops when
paused and when the tab is hidden.

## 7. The CTAs cannot point at the wrong track

§9's hard requirement is that the CTA opens the track currently in the player,
never a homepage. Both CTAs derive their `href` from `external_urls.spotify` on
the same store index the player renders from, so there is no code path where they
can disagree. They are hidden entirely while initializing, with no track, or on
error, per §9's visibility table.

## 8. Single viewport: `dvh` with a `@supports` fallback

§23 asks for `100dvh`. The first implementation wrote `height: 100svh;` followed
by `height: 100dvh;` as a fallback pair — and the CSS minifier **silently dropped
the first**, because they are the same property. The fallback existed in source
and not in the shipped stylesheet.

It is now expressed as `height: 100vh` with a `@supports (height: 100dvh)`
override, which survives minification. This is verified in the built CSS, not
just in source.

The shell is a three-row grid (CTA zone / stage / player) where only the stage
row may shrink, so the player is structurally incapable of being pushed out of
the viewport.

## 9. What was removed

The repo previously held two earlier explorations — a self-hosted catalogue and a
YouTube IFrame player — plus a Redis listener count. All are gone: none appear in
the Pattu Vandi PRD, and §36's MVP list does not include a listener count.
Nothing was committed to git before deletion, so there is no history to recover
them from.

---

## 10. Verified / not verified

**Verified**

- `tsc --noEmit`, `eslint`, and a clean production build all pass.
- 36 HTTP assertions against `next start`:
  - `/api/spotify/token` returns 401 without a session, `no-store`, and never
    includes a refresh token in the body.
  - `/api/track/:id` rejects a malformed id with 400 before it reaches Spotify.
  - With bad credentials, `/api/tracks` and `/api/track/:id` return **502, not
    500**, and expose no raw Spotify error (§27) — `/api/tracks` still returns an
    array so the client cannot crash on `undefined`.
  - `/auth/spotify` redirects to `accounts.spotify.com/authorize` with
    `response_type=code`, the `streaming` scope, a 32-hex CSRF `state`, and an
    HttpOnly `SameSite=Lax` state cookie — with no secret in the URL.
  - The callback rejects a mismatched `state` and handles denied consent.
  - Built CSS carries `100dvh`, the `@supports` fallback, safe-area insets,
    `overflow:hidden` on html/body, the three-row grid, `touch-action:none` on the
    slider, and a `prefers-reduced-motion` block.
  - robots, sitemap, manifest, icon, and a real 1200×630 OG PNG.
- **§30 credential isolation**, by sentinel scan across all client chunks and
  prerendered HTML.

**Not verified — needs a Spotify app and a Premium account in a browser**

- **No playback has ever been exercised.** The SDK has never loaded, no device has
  been registered, no track has played, and the progress poll has never run
  against a real player.
- The full OAuth round trip. Only the entry redirect and the failure branches were
  exercised; the code exchange needs real credentials.
- `/api/tracks` against real Spotify — every run so far used deliberately invalid
  credentials to test the failure path.
- §38's responsive matrix, and §35's cross-browser playback testing. There is no
  browser in this environment.
- Whether the interpolated progress bar stays in step over a full track.

---

## 11. What only you can do

1. Create an app at <https://developer.spotify.com/dashboard>.
2. Put its **Client ID** and **Client Secret** in `.env.local`.
3. Register the redirect URI **byte for byte**:
   `http://127.0.0.1:3000/auth/spotify/callback` (and the production equivalent
   before launch).
4. Sign in with a **Premium** account to test playback.
5. Resolve §14 against Spotify's current Developer Terms for the intended
   business model.

Until 1–3 are done the interface still renders — it shows a "Connect Spotify"
state — but nothing will play.
