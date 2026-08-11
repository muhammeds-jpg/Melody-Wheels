# Melody Wheels

A music player that happens to be a website. One screen, one song at a time, and
a way straight into the playlist on Spotify or YouTube Music.

**A visitor opens the site and presses play. That is the whole contract.** No
login, no Spotify account, no Premium, no cookie banner — and they hear the
*full* song, not a 30-second sample.

---

## How it plays music without asking anyone to log in

Three public endpoints, no credentials anywhere:

| What | Where it comes from | Needs a key? |
| --- | --- | --- |
| The song list, in order | `open.spotify.com/embed/playlist/<id>` | no |
| Album artwork + real durations | `open.spotify.com/embed/track/<id>` | no |
| The audio, at **full length** | YouTube IFrame Player API | no |
| Backup audio (30s) | the preview mp3 in Spotify's embed payload | no |

`npm run sync` does the first three offline and writes
[src/config/catalogue.generated.ts](src/config/catalogue.generated.ts), which is
committed. At runtime the site serves that file straight from memory — so the
player is ready as fast as the page, and a deploy makes **zero** third-party
calls to boot.

Spotify's *official* Web API is deliberately not used. It refuses to list a
public playlist's contents without a logged-in user token, and it strips
`preview_url` entirely. The embed payload has both.

### Playback modes

| Situation | Engine | Length |
| --- | --- | --- |
| Anyone, no account (the normal case) | YouTube IFrame API | **full track** |
| A track with no confident video match | Spotify preview mp3 | 30s |
| YouTube blocked by an extension or network | Spotify preview mp3 | 30s |
| Optional: listener connected Spotify Premium | Web Playback SDK | full track |

The pill only ever says "Preview" — it never asks anyone to sign in, because
there is nothing to sign in to.

---

## Getting started

```bash
npm install
npm run sync          # builds the catalogue from the playlist
npm run dev           # http://127.0.0.1:3000
```

There is no `.env.local` step. Copy `.env.example` if you want to change the
playlist by hand or enable the optional extras, but nothing in it is required.

---

## Changing the playlist

One command. Pass a URL, a `spotify:` URI, or a bare id:

```bash
npm run sync -- https://open.spotify.com/playlist/<id>
npm run sync -- spotify:playlist:<id>
npm run sync -- <id>
```

It reads the playlist, finds a YouTube video for every track, verifies each one
actually plays embedded, writes the id into `.env.local`, and regenerates the
catalogue. Then restart the dev server.

That command is the ONLY place the playlist is chosen. `catalogue.generated.ts`
and `.env.local` are both written by it, and `src/config/playlist.ts` derives its
default from the generated file — so there is no second copy of the id to
forget. Nothing else needs editing, on your machine or on the host.

Running it with no argument re-syncs whatever is already configured — useful
after you add songs to the playlist.

**The playlist must be public.** Open it in a private window to check; if the
songs do not appear there, the site cannot read it either.

It works six tracks at a time, so a handful of songs takes seconds and a
100-track playlist takes a few minutes. It searches YouTube and confirms each
video really plays embedded rather than trusting the first result, which is where
the time goes. An unreachable page is skipped rather than aborting the run.

### Reading the output

```
 1/3  Khalbinnakame (From "Abhilasham")    fBve4qWA8Go   2:54 vs   2:50  ok
```

That is the video it picked, its length, and the length Spotify reports. `ok`
means the two agree closely enough to be the same recording. A large percentage
means it probably matched something else — a live version, a cover, a
compilation — and is worth checking by ear.

`NO MATCH` means nothing convincing was found, so that track falls back to its
30-second preview. Matching by length is deliberate: a full-length *wrong* song
is worse than a correct clip.

---

## Deploying

Push to a host that runs Next.js server-side. `netlify.toml` is already set up:
it declares `@netlify/plugin-nextjs` and deliberately does **not** set a
`publish` directory — pointing that at a folder by hand is the usual reason a
Next app answers its own 404 on every route, including `/`.

The only environment variable worth setting in production is
`NEXT_PUBLIC_SITE_URL`, so OG tags and the sitemap use the real domain. The
playlist id is read from `.env.local` at sync time and baked into the committed
catalogue, so it does not need to be set on the host.

---

## Commands

| | |
| --- | --- |
| `npm run dev` | dev server on 127.0.0.1:3000 |
| `npm run sync` | rebuild the catalogue from the playlist |
| `npm run sync -- <url>` | switch to a different playlist |
| `npm run build` | production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint |
| `npm run check:env` | report what is configured |

Building while `npm run dev` is running corrupts both — they share `.next`. Use
a separate directory:

```bash
NEXT_DIST_DIR=.next-build npx next build
```

---

## Architecture

```
src/
  config/
    playlist.ts               which playlist, and how to parse its id
    catalogue.generated.ts    GENERATED by `npm run sync` — the baked song list
    tracks.ts                 site copy, and the two top-bar links
  lib/
    catalogue.ts              server-only: serves the baked list
    youtube-engine.ts         the IFrame player — full-length audio, no account
    preview-engine.ts         a single HTMLAudioElement — the 30s fallback
    audio-engine.ts           Spotify Web Playback SDK — optional
    player-store.ts           one set of controls over all three engines
    presence.ts               the live listener count
  components/
    YouTubeMount.tsx          hosts the iframe that makes the sound
    PlayerPill.tsx            artwork, scrubber, transport
```

### Things that will bite you

- **Each engine is a module-scope singleton, never built inside a component.**
  React Strict Mode double-mounts, and a player constructed in the tree becomes
  two players talking over each other. The API script load is guarded by a
  cached Promise rather than a null check, so two calls in one tick cannot both
  append the script tag.

- **The YouTube iframe must be rendered.** `display:none`, `visibility:hidden`
  and a 0×0 box each stop playback outright in Safari and get the frame
  throttled in Chrome. It is laid out at 320×180 and made transparent instead.

- **The player is constructed on page load, not on first press.** It cues the
  first video from the committed catalogue, which is available synchronously.
  Waiting for `/api/tracks` first left a window where a quick click arrived
  before the API had connected, and the first song of a session played as a
  30-second preview.

- **`engineDurationMs` beats the track's own metadata.** YouTube's copy of a song
  is rarely the exact length of Spotify's, and a preview is 30 seconds of a
  three-minute track. Whichever engine is playing is the authority on how long
  the thing playing is. Getting this wrong produced a player that said "Full
  track" over a bar stopping at 0:30.

- **`youtubeFailed` is not `!youtubeReady`.** One is permanent, the other is a
  second of loading. Conflating them is what caused the bug above.

- **The backdrop must not sit at a negative z-index.** `body` carries an opaque
  background colour, and a fixed element behind it paints under that rather than
  under the content — the artwork vanishes and the screen goes black.
