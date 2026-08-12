import { create } from "zustand";
import type { Track, WebPlaybackState } from "./types";
import * as preview from "./preview-engine";
import * as spotify from "./audio-engine";
import * as youtube from "./youtube-engine";
import { readResume, resolveResume, writeResume } from "./resume";

/**
 * Three engines behind one set of controls.
 *
 *  - **youtube** — the IFrame Player API, streaming the FULL track. The default
 *    for everyone: no account, no Premium, no API key. This is what makes the
 *    site behave like saloon.wtf — open it, press play, hear the whole song.
 *  - **preview** — an `HTMLAudioElement` on Spotify's own 30-second preview mp3.
 *    Used only for a track with no YouTube match, or when YouTube is blocked.
 *  - **spotify** — the Web Playback SDK. An optional extra for a listener who
 *    has connected a Premium account; nothing requires it.
 *
 * Every transport action branches on `mode`; nothing above this file needs to
 * know which engine is running.
 */
export type PlaybackMode = "youtube" | "preview" | "spotify";

export type YouTubePhase = "playing" | "paused" | "buffering" | "ended";

type PlayerState = {
  tracks: Track[];
  index: number;

  mode: PlaybackMode;
  /** The IFrame player has registered and will accept commands immediately. */
  youtubeReady: boolean;
  /**
   * YouTube is unusable in this browser — the API script was blocked, or it
   * never came up. Distinct from "not ready yet": one is permanent, the other is
   * a second of loading, and treating them the same is what once dropped the
   * first song of a session to a 30-second preview.
   */
  youtubeFailed: boolean;
  /** A Spotify session exists. Only relevant to the optional SDK path. */
  isConnected: boolean;
  /** The SDK has registered a device. */
  spotifyReady: boolean;

  isLoadingCatalogue: boolean;
  catalogueError: string | null;

  isPlaying: boolean;
  isBuffering: boolean;
  isIdle: boolean;
  progressMs: number;
  /**
   * Length reported by whichever engine is currently playing, or 0 before it
   * says. It has to win over the track's own metadata: YouTube's copy of a song
   * is rarely the exact length of Spotify's, and a preview is 30 seconds of a
   * three-minute track. Getting this wrong is what once produced a player
   * announcing "Full track" over a bar that stopped at 0:30.
   */
  engineDurationMs: number;
  muted: boolean;
  error: string | null;

  setTracks: (tracks: Track[]) => void;
  setCatalogueError: (message: string | null) => void;
  setConnected: (connected: boolean) => void;
  setSpotifyReady: (ready: boolean) => void;
  setYoutubeReady: (ready: boolean) => void;
  setYoutubeFailed: (failed: boolean) => void;

  toggle: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (ms: number) => void;
  toggleMute: () => void;

  setPlaying: (playing: boolean) => void;
  setBuffering: (buffering: boolean) => void;
  setProgress: (ms: number) => void;
  setPreviewProgress: (positionMs: number, durationMs: number) => void;
  setError: (message: string | null) => void;
  handleEnded: () => void;
  /** Write the resume point immediately, bypassing the throttle. */
  savePositionNow: () => void;

  /** Mirror of the IFrame player's onStateChange. */
  handleYoutubeState: (phase: YouTubePhase) => void;
  setYoutubeProgress: (positionMs: number, durationMs: number) => void;
  handleYoutubeError: (message: string) => void;

  /** Mirror of the SDK's player_state_changed. */
  syncFromSpotify: (state: WebPlaybackState | null) => void;
};

/**
 * Says the one thing worth saying when YouTube refuses an embed: check the
 * address bar.
 *
 * A bare IP origin — a LAN address, or 127.0.0.1, which counts as one — makes
 * YouTube refuse a large share of music videos with error 150, and the player
 * quietly serves 30-second previews instead. That is indistinguishable from a
 * badly-matched catalogue unless someone happens to know this, so the console
 * says it rather than leaving the next person to measure it again. Measured over
 * one 44-track playlist in one browser: localhost 44/44, 127.0.0.1 11/44,
 * 192.168.x.x 12/44.
 *
 * Once per session, and console-only: it is a note for whoever is building the
 * site, not something to put in front of a listener.
 */
let warnedAboutOrigin = false;
function warnIfBareIpOrigin(): void {
  if (warnedAboutOrigin || typeof window === "undefined") return;
  // Bracketed forms are IPv6 literals; the dotted form covers IPv4.
  const host = window.location.hostname;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !host.startsWith("[")) return;
  warnedAboutOrigin = true;
  console.warn(
    `youtube: refused to embed on origin ${window.location.origin}. YouTube ` +
      `blocks many music videos when the embedding origin is a bare IP address, ` +
      `so these tracks drop to 30-second previews. Open the site at ` +
      `http://localhost:${window.location.port || "3000"} instead — the hostname, ` +
      `not an IP — or deploy it to a real domain.`,
  );
}

/**
 * The duration of whatever is ACTUALLY playing — never a number borrowed from
 * the other engine. See `engineDurationMs`.
 */
function durationOf(
  track: Track | undefined,
  mode: PlaybackMode,
  engineDurationMs: number,
): number {
  if (engineDurationMs > 0) return engineDurationMs;
  if (!track) return 0;
  // Spotify's previews are a flat 30s; the real length would overstate the bar.
  if (mode === "preview") return track.previewDuration ?? 30_000;
  return track.duration;
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  /**
   * Videos YouTube refused to embed. Remembered so a track that failed once
   * goes straight to its preview next time instead of stalling again.
   */
  const blockedVideos = new Set<string>();

  /**
   * How many tracks in a row have been stepped over because their video was
   * blocked and they had no preview to fall back to.
   *
   * Bounded, and reset the moment anything actually plays. Skipping on an error
   * is what keeps the music going, but each skip can raise the same error again,
   * and without a ceiling a playlist of blocked videos would race through itself
   * on a chain of error events.
   */
  let blockedRun = 0;

  /**
   * Where to start the FIRST track of the session, restored from a previous
   * visit. Consumed once — after that, playback position comes from the engine.
   */
  let resumeMs = 0;

  /**
   * Throttle for writing the position. `timeupdate` fires several times a second
   * and localStorage is synchronous, so persisting every tick would do real work
   * on the main thread for no benefit.
   */
  let lastSaved = 0;
  function savePosition(force = false) {
    const { tracks, index, progressMs } = get();
    const track = tracks[index];
    if (!track) return;
    const now = Date.now();
    if (!force && now - lastSaved < 4000) return;
    lastSaved = now;
    writeResume({ trackId: track.id, positionMs: progressMs });
  }

  /** Cancels the pending "YouTube never started" fallback, if one is armed. */
  let watchdog: number | null = null;
  function clearWatchdog() {
    if (watchdog !== null) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  }

  /**
   * Chooses YouTube even before the IFrame API has finished loading.
   *
   * This is deliberate, and it is the fix for the first song of a session
   * playing only 30 seconds. The API script takes a second or two, a listener
   * can easily click faster than that, and requiring `youtubeReady` here meant
   * the first press committed to a preview and then had no way back — the mode
   * only ever upgraded while idle, and pressing play is what ends idle.
   *
   * The engine queues a load issued before it is ready and applies it on
   * connect, so committing early costs nothing. `youtubeFailed` covers the case
   * where it genuinely never arrives, and `armWatchdog` covers it going quiet.
   */
  function bestMode(track: Track | undefined): PlaybackMode {
    if (!track) return "preview";
    const { youtubeFailed, spotifyReady } = get();
    if (track.youtubeId && !youtubeFailed && !blockedVideos.has(track.youtubeId)) return "youtube";
    if (spotifyReady) return "spotify";
    return "preview";
  }

  /**
   * Can anything actually make a sound for this track?
   *
   * A track needs either a YouTube match or a preview mp3, and some have
   * neither: Spotify omits the preview for a fair number of tracks (8 of 100 on
   * one real playlist), and not every song can be found on YouTube. Without this
   * check, hitting one such track stops the playlist dead on silence.
   */
  function isPlayable(track: Track | undefined): boolean {
    if (!track) return false;
    const { youtubeFailed } = get();
    if (track.youtubeId && !youtubeFailed && !blockedVideos.has(track.youtubeId)) return true;
    return Boolean(track.previewUrl);
  }

  /**
   * If YouTube has not made a sound within a few seconds, stop waiting and play
   * the preview instead. Silence with a pause icon showing is the worst possible
   * outcome, so this trades full length for something audible.
   */
  function armWatchdog(track: Track) {
    clearWatchdog();
    watchdog = window.setTimeout(() => {
      watchdog = null;
      const s = get();
      if (s.mode !== "youtube" || s.isPlaying || s.isIdle) return;
      if (!track.previewUrl) return;
      set({ mode: "preview", engineDurationMs: 0, isBuffering: true });
      preview.load(track.previewUrl);
      void preview.play();
    }, 6000);
  }

  /** Start `track` on `mode`. The one place playback is actually kicked off. */
  function start(track: Track, mode: PlaybackMode, autoplay: boolean) {
    if (mode === "youtube" && track.youtubeId) {
      // The watchdog is armed for EVERY autoplay attempt, not just the
      // not-ready case. A play command that is accepted and then quietly does
      // nothing is the failure that actually happens, and it used to have no
      // recovery at all — the transport showed Pause over a frozen 0:00.
      if (autoplay) armWatchdog(track);

      // The restored offset applies to the first start only, and is spent here:
      // leaving it set would make every later track jump to the same timestamp.
      const startSeconds = resumeMs > 0 ? resumeMs / 1000 : 0;
      if (startSeconds > 0) resumeMs = 0;

      // Before the player exists, `load` queues and replays on connect — so a
      // press that lands during the API load is honoured rather than dropped.
      if (!youtube.isReady()) {
        youtube.load(track.youtubeId, autoplay, startSeconds);
        return;
      }

      // `playVideo()` on the video merely CUED at mount is unreliable, so the
      // first start always goes through an explicit load. Afterwards, reloading
      // would restart the track instead of resuming, so play() is correct.
      const needsExplicitLoad =
        youtube.currentVideo() !== track.youtubeId || (autoplay && !youtube.hasEverPlayed());

      // Keeping this synchronous matters: it must stay inside the listener's
      // click, or mobile browsers refuse the audio.
      if (needsExplicitLoad) youtube.load(track.youtubeId, autoplay, startSeconds);
      else if (autoplay) youtube.play();
      return;
    }

    if (mode === "spotify") {
      const { tracks, index } = get();
      void spotify
        .playUris(
          tracks.map((t) => t.uri),
          index,
        )
        .catch(() =>
          set({ isBuffering: false, error: "Spotify couldn't start that track." }),
        );
      return;
    }

    if (!track.previewUrl) {
      set({ isBuffering: false, isPlaying: false, error: "No audio for this track." });
      return;
    }
    preview.load(track.previewUrl);
    // A preview is 30 seconds of the track, so a resume offset taken from a
    // full-length stream would be past its end. Only honour one that fits.
    if (resumeMs > 0) {
      const seconds = resumeMs / 1000;
      resumeMs = 0;
      if (seconds < 25) preview.seek(seconds);
    }
    if (autoplay) void preview.play();
  }

  /**
   * The single path every track change goes through.
   *
   * @param step - which way to keep going if a track turns out to be silent.
   *   Skipping must follow the listener's direction: pressing Previous onto an
   *   unplayable track should carry on backwards, not spring forwards.
   * @param skipped - guard against a playlist where nothing can play. Without
   *   it, an all-silent catalogue would recurse forever.
   */
  function goTo(nextIndex: number, autoplay: boolean, step: 1 | -1 = 1, skipped = 0) {
    const { tracks } = get();
    if (tracks.length === 0) return;

    clearWatchdog();

    const wrapped = ((nextIndex % tracks.length) + tracks.length) % tracks.length;
    const track = tracks[wrapped];

    // Step over a track that has neither a video nor a preview, rather than
    // landing on it and going quiet with the transport still showing Pause.
    if (!isPlayable(track)) {
      if (skipped < tracks.length - 1) {
        goTo(wrapped + step, autoplay, step, skipped + 1);
        return;
      }
      set({
        index: wrapped,
        isPlaying: false,
        isBuffering: false,
        error: "Nothing in this playlist can be played.",
      });
      return;
    }

    const mode = bestMode(track);

    // Stop the engine we are leaving, or two tracks play over each other.
    const previous = get().mode;
    if (previous !== mode) {
      if (previous === "youtube") youtube.pause();
      else if (previous === "preview") preview.pause();
    }

    // Clearing engineDurationMs matters: holding the previous track's length
    // would size the new track's bar wrongly until the first tick lands.
    set({
      index: wrapped,
      mode,
      progressMs: 0,
      engineDurationMs: 0,
      isIdle: false,
      error: null,
      isBuffering: autoplay,
    });

    // Record the new track at once. A reload immediately after skipping should
    // land here, not back on whatever was playing before.
    savePosition(true);

    start(track, mode, autoplay);
  }

  return {
    tracks: [],
    index: 0,
    mode: "preview",
    youtubeReady: false,
    youtubeFailed: false,
    isConnected: false,
    spotifyReady: false,

    isLoadingCatalogue: true,
    catalogueError: null,

    isPlaying: false,
    isBuffering: false,
    isIdle: true,
    progressMs: 0,
    engineDurationMs: 0,
    muted: false,
    error: null,

    setTracks: (tracks) =>
      set(() => {
        // Pick up where the last visit stopped. Matched by track id, not index,
        // so a playlist change resolves to nothing and starts from the top
        // rather than resuming at whatever song now sits in that slot.
        const resume = resolveResume(readResume(), tracks);
        const index = resume?.index ?? 0;
        resumeMs = resume?.positionMs ?? 0;

        return {
          tracks,
          index,
          // Shown before the first press, so the pill reads "2:31 / 4:56" and
          // the transport visibly continues rather than appearing to restart.
          progressMs: resumeMs,
          isLoadingCatalogue: false,
          catalogueError: null,
          // Point at YouTube straight away when the list carries video ids, so
          // the display reads the real length rather than 0:30 up front.
          //
          // Through `bestMode` rather than its own copy of the rule: an embed
          // refusal can already have arrived by the time the catalogue lands —
          // the iframe starts loading with the page — and a hand-rolled check
          // here would point at a video already known to be blocked.
          mode: bestMode(tracks[index]),
        };
      }),

    setCatalogueError: (catalogueError) => set({ catalogueError, isLoadingCatalogue: false }),

    setConnected: (isConnected) => set({ isConnected }),

    setYoutubeReady: (youtubeReady) =>
      set((s) => ({
        youtubeReady,
        // Coming up clears any earlier failure, so a retry can recover.
        youtubeFailed: youtubeReady ? false : s.youtubeFailed,
      })),

    setYoutubeFailed: (youtubeFailed) =>
      set((s) => {
        if (!youtubeFailed) return { youtubeFailed };
        clearWatchdog();
        const track = s.tracks[s.index];
        // Nothing will ever come from YouTube, so hand the current track to the
        // preview rather than leaving a play button that does nothing.
        if (s.mode === "youtube" && track?.previewUrl) {
          preview.load(track.previewUrl);
          if (!s.isIdle) void preview.play();
          return { youtubeFailed, mode: "preview" as PlaybackMode, engineDurationMs: 0 };
        }
        return { youtubeFailed, mode: s.mode === "youtube" ? "preview" : s.mode };
      }),

    setSpotifyReady: (spotifyReady) =>
      set((s) => ({
        spotifyReady,
        // YouTube already gives full tracks to everyone, so it keeps priority;
        // the SDK only picks up tracks YouTube could not cover.
        mode:
          s.isIdle && spotifyReady && s.mode === "preview" && !s.tracks[s.index]?.youtubeId
            ? "spotify"
            : !spotifyReady && s.mode === "spotify"
              ? "preview"
              : s.mode,
      })),

    toggle: () => {
      const { isPlaying, isIdle, tracks, index } = get();
      if (tracks.length === 0) return;
      const track = tracks[index];

      // The first press decides the engine: by now we know whether the IFrame
      // player came up, which was not yet true when the page loaded.
      if (isIdle) {
        // If the playlist happens to open on a track with no audio, move to one
        // that has some rather than answering the first press with silence.
        if (!isPlayable(track)) {
          goTo(index + 1, true);
          return;
        }
        const mode = bestMode(track);
        set({ mode, isIdle: false, isBuffering: true, error: null, engineDurationMs: 0 });
        start(track, mode, true);
        return;
      }

      const { mode } = get();

      if (mode === "youtube") {
        if (isPlaying) youtube.pause();
        else youtube.play();
        return;
      }

      if (mode === "spotify") {
        void spotify.togglePlay();
        return;
      }

      if (isPlaying) preview.pause();
      else void preview.play();
    },

    next: () => {
      // Spotify keeps its own queue, so let the SDK advance it and report back.
      if (get().mode === "spotify") {
        void spotify.nextTrack();
        return;
      }
      goTo(get().index + 1, !get().isIdle);
    },

    prev: () => {
      // Standard behaviour: restart the track if we are more than 3s in.
      if (get().progressMs > 3000) {
        const { mode } = get();
        if (mode === "youtube") youtube.seek(0);
        else if (mode === "spotify") void spotify.seek(0);
        else preview.seek(0);
        set({ progressMs: 0 });
        return;
      }
      if (get().mode === "spotify") {
        void spotify.previousTrack();
        return;
      }
      // step -1: keep going backwards if the previous track has no audio.
      goTo(get().index - 1, !get().isIdle, -1);
    },

    seekTo: (ms) => {
      const { tracks, index, mode, engineDurationMs } = get();
      const duration = durationOf(tracks[index], mode, engineDurationMs);
      const clamped = Math.max(0, Math.min(ms, duration || ms));
      set({ progressMs: clamped }); // optimistic: keeps the thumb under the finger
      if (mode === "youtube") youtube.seek(clamped / 1000);
      else if (mode === "spotify") void spotify.seek(clamped);
      else preview.seek(clamped / 1000);
    },

    toggleMute: () => {
      const muted = !get().muted;
      set({ muted });
      const { mode } = get();
      if (mode === "youtube") youtube.setMuted(muted);
      else if (mode === "spotify") void spotify.setMuted(muted);
      else preview.setMuted(muted);
    },

    setPlaying: (isPlaying) => {
      // Sound is coming out, so the run of blocked videos has ended here too.
      if (isPlaying) blockedRun = 0;
      set({ isPlaying, isBuffering: false, isIdle: false });
      // Pausing is the strongest signal that this is the spot to come back to,
      // so it is written immediately rather than waiting for the next throttle.
      if (!isPlaying) savePosition(true);
    },
    setBuffering: (isBuffering) => set({ isBuffering }),
    setProgress: (progressMs) => {
      set({ progressMs });
      savePosition();
    },
    setError: (error) => set({ error }),

    setPreviewProgress: (progressMs, durationMs) => {
      set(durationMs > 0 ? { progressMs, engineDurationMs: durationMs } : { progressMs });
      savePosition();
    },

    savePositionNow: () => savePosition(true),

    handleEnded: () => goTo(get().index + 1, true),

    /* ── YouTube ─────────────────────────────────────────────────────────── */

    handleYoutubeState: (phase) => {
      if (get().mode !== "youtube") return;
      switch (phase) {
        case "playing":
          // It made it. Stop the fallback from stealing playback later, and let
          // the skip budget refill — a run of blocked videos is over.
          clearWatchdog();
          blockedRun = 0;
          set({ isPlaying: true, isBuffering: false, isIdle: false, error: null });
          break;
        case "paused":
          set({ isPlaying: false, isBuffering: false });
          break;
        case "buffering":
          set({ isBuffering: true });
          break;
        case "ended":
          set({ isPlaying: false });
          get().handleEnded();
          break;
      }
    },

    setYoutubeProgress: (progressMs, durationMs) => {
      if (get().mode !== "youtube") return;
      set(durationMs > 0 ? { progressMs, engineDurationMs: durationMs } : { progressMs });
      savePosition();
    },

    handleYoutubeError: (message) => {
      clearWatchdog();
      const { tracks, index, isIdle } = get();
      const track = tracks[index];

      /**
       * Which video failed, asked of the ENGINE rather than inferred from the
       * store's current index.
       *
       * This is the fix for a message that had no way of clearing itself. The
       * iframe is built and its video cued from the committed catalogue as the
       * page loads, while `tracks` stays empty until /api/tracks answers — and a
       * video the uploader has blocked reports it the instant it is cued, which
       * is usually inside that window. Reading the id from `tracks[index]` found
       * `undefined` there, skipped every fallback below, and left the raw
       * "the uploader doesn't allow this video off YouTube" pinned to the player
       * over a play button that would in fact have worked.
       */
      const failedId = youtube.currentVideo();

      // Being refused an embed is permanent — retrying it is pointless — so the
      // video is remembered and never chosen again this session.
      if (youtube.isEmbedBlocked(message)) {
        if (failedId) blockedVideos.add(failedId);
        warnIfBareIpOrigin();

        // No catalogue yet: nothing to fall back to and nothing worth saying.
        // The id is recorded, so whatever chooses next will not choose this.
        if (!track) {
          set({ isBuffering: false, isPlaying: false, error: null });
          return;
        }

        // Drop to the 30-second preview, and keep playing if we already were.
        if (track.previewUrl) {
          set({ mode: "preview", engineDurationMs: 0, isBuffering: !isIdle, error: null });
          preview.load(track.previewUrl);
          if (!isIdle) void preview.play();
          return;
        }

        // Blocked, and no preview either. Nothing has started yet, so say
        // nothing: `isPlayable` now reports false for this track, and the first
        // press steps over it the same way it steps over a silent one.
        if (isIdle) {
          set({ isBuffering: false, isPlaying: false, error: null });
          return;
        }

        // Mid-listen, so keep the music going rather than stopping on a message.
        if (blockedRun < tracks.length) {
          blockedRun += 1;
          goTo(index + 1, true);
          return;
        }
      }

      set({ isBuffering: false, isPlaying: false, error: message });
    },

    /* ── Spotify (optional) ──────────────────────────────────────────────── */

    syncFromSpotify: (state) => {
      if (get().mode !== "spotify") return;
      if (!state) {
        // Playback moved to another Spotify device.
        set({ isPlaying: false });
        return;
      }
      const { tracks } = get();
      const uri = state.track_window.current_track.uri;
      const found = tracks.findIndex((t) => t.uri === uri);

      set({
        ...(found >= 0 ? { index: found } : {}),
        isPlaying: !state.paused,
        isBuffering: false,
        isIdle: false,
        progressMs: state.position,
        ...(state.duration > 0 ? { engineDurationMs: state.duration } : {}),
        error: null,
      });
    },
  };
});

export function useCurrentTrack(): Track | null {
  return usePlayerStore((s) => s.tracks[s.index] ?? null);
}

export function useDurationMs(): number {
  return usePlayerStore((s) => durationOf(s.tracks[s.index], s.mode, s.engineDurationMs));
}

/** True when the whole track is playing rather than a 30-second clip. */
export function useIsFullTrack(): boolean {
  return usePlayerStore((s) => s.mode === "youtube" || s.mode === "spotify");
}
