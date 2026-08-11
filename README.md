# Melody Wheels

> A music player that happens to be a website.

One screen, no scrolling, no navigation. A persistent player, a live listener
count, and the current playlist always one click from Spotify.

Next.js 15 (App Router) · TypeScript strict · Tailwind v4 · Zustand ·
Spotify Web API + Web Playback SDK.

---

## Changing the playlist

**The easy way — open `/playlists` in the browser where you connected Spotify:**

```
http://127.0.0.1:3000/playlists
```

It lists every playlist on your account. Click **Use this playlist**, then
restart the dev server. That's it.

That page does two things a terminal command cannot:

1. reads **private** playlists (needs your session)
2. rebuilds `SEED_TRACKS` — what visitors who have *not* connected Spotify see

Both need the Spotify session, which lives in an httpOnly cookie only the
browser holds.

**The manual way**, if you already know the playlist id:

```bash
npm run set:playlist 2fi56elb3MinYMHkzVshOH
npm run set:playlist https://open.spotify.com/playlist/2fi56elb3MinYMHkzVshOH
npm run set:playlist spotify:playlist:2fi56elb3MinYMHkzVshOH
```

All three forms work, including share links with `?si=…`. This sets the playlist
but **cannot** rebuild the seed — use `/playlists` for that.

Or edit `.env.local` directly and restart:

```
NEXT_PUBLIC_SPOTIFY_PLAYLIST_ID=2fi56elb3MinYMHkzVshOH
```

> Restart the dev server after any of these. Next.js only reads env files at
> startup.

**Finding the id by hand:** in Spotify, right-click the playlist → Share → Copy
link. The id is the part after `/playlist/`.

---

## Two playback modes

| | Not connected | Connected + Premium |
|---|---|---|
| Audio | 30-second previews (Apple) | **full tracks** (Spotify SDK) |
| Login | none | Spotify sign-in |
| Catalogue | `SEED_TRACKS` fallback | the real playlist |

The pill shows **"Full track"** in green when streaming in full, or
**"Connect for full tracks"** otherwise. Spotify's Web API returns no audio URL
of any kind — `preview_url` is absent from its track object — which is why
previews come from Apple and full playback goes through the SDK.

## Setup

```bash
npm install
npm run gen:icons
cp .env.example .env.local     # then fill in the two Spotify values
npm run dev
```

Open **http://127.0.0.1:3000** — not `localhost`. Spotify rejects `localhost` as
a redirect URI, and the two are different cookie origins.

In the [Spotify dashboard](https://developer.spotify.com/dashboard):

1. copy the **Client ID** and **Client Secret** into `.env.local`
2. add this redirect URI, byte for byte:
   `http://127.0.0.1:3000/auth/spotify/callback`
3. under *APIs used*, tick **Web API** and **Web Playback SDK**

`npm run check:env` reports anything missing or malformed.

Two constraints worth knowing up front:

- **Full playback needs Premium** — the `streaming` scope refuses free accounts.
- **Development mode** apps only allow allowlisted users to sign in. The app
  owner is included automatically; anyone else must be added under
  *User Management*.

## Scripts

| | |
|---|---|
| `npm run dev` | dev server |
| `npm run build` / `start` | production build / serve |
| `npm run typecheck` / `lint` | static checks |
| `npm run check:env` | says exactly which Spotify values are missing |
| `npm run set:playlist <id>` | point the site at a playlist |
| `npm run gen:icons` | regenerate PWA / touch icons |

Building while `npm run dev` is running corrupts `.next`. Use a separate
directory instead:

```bash
NEXT_DIST_DIR=.next-build npm run build
```

## Layout

```
src/
├── app/          page, /playlists, api/, auth/, metadata routes
├── components/   MelodyWheels (shell), TopBar, Hero, PlayerPill
├── config/       playlist.ts (the playlist + seed), tracks.ts (site copy)
├── lib/          catalogue, audio-engine (SDK), preview-engine (HTMLAudio),
│                 spotify-server (SERVER ONLY), presence, player-store
└── styles/       globals.css
```

Four rules worth knowing before editing:

- **`lib/spotify-server.ts` is server-only.** Importing it from a `"use client"`
  file would pull the client secret into the browser bundle.
- **Each engine owns exactly one player instance**, created at module scope. The
  guard is a cached *promise*, not a null check — `init()` awaits a script, so a
  null check lets React Strict Mode build two.
- **The transport never sets state directly.** It calls the engine; the
  resulting event updates the store. One source of truth.
- **`duration` is the preview length, `fullDuration` the real one.** The bar
  always states the length of whatever is actually playing.

## Deploying

`.env.local` is gitignored and must never be committed. Set the same variables
in your host's dashboard, add the production redirect URI to the Spotify app
(`https://yourdomain.com/auth/spotify/callback`), and set
`NEXT_PUBLIC_SITE_URL`.

The live listener count uses in-memory storage by default, which only counts
correctly on a single instance. Set `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` for anything multi-instance, such as Vercel.
