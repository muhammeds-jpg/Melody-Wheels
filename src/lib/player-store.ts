import { create } from "zustand";
import type { Track, WebPlaybackState } from "./types";
import * as preview from "./preview-engine";
import * as spotify from "./audio-engine";
import * as youtube from "./youtube-engine";

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

  /** Mirror of the IFrame player's onStateChange. */
  handleYoutubeState: (phase: YouTubePhase) => void;
  setYoutubeProgress: (positionMs: number, durationMs: number) => void;
  handleYoutubeError: (message: string) => void;

  /** Mirror of the SDK's player_state_changed. */
  syncFromSpotify: (state: WebPlaybackState | null) => void;
};

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

      // Before the player exists, `load` queues and replays on connect — so a
      // press that lands during the API load is honoured rather than dropped.
      if (!youtube.isReady()) {
        youtube.load(track.youtubeId, autoplay);
        return;
      }

      // `playVideo()` on the video merely CUED at mount is unreliable, so the
      // first start always goes through an explicit load. Afterwards, reloading
      // would restart the track instead of resuming, so play() is correct.
      const needsExplicitLoad =
        youtube.currentVideo() !== track.youtubeId || (autoplay && !youtube.hasEverPlayed());

      // Keeping this synchronous matters: it must stay inside the listener's
      // click, or mobile browsers refuse the audio.
      if (needsExplicitLoad) youtube.load(track.youtubeId, autoplay);
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
      set((s) => ({
        tracks,
        index: 0,
        isLoadingCatalogue: false,
        catalogueError: null,
        // Point at YouTube straight away when the list carries video ids, so the
        // display reads the real length rather than 0:30 before the first press.
        mode:
          tracks[0]?.youtubeId && !s.youtubeFailed
            ? "youtube"
            : s.spotifyReady
              ? "spotify"
              : "preview",
      })),

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

    setPlaying: (isPlaying) => set({ isPlaying, isBuffering: false, isIdle: false }),
    setBuffering: (isBuffering) => set({ isBuffering }),
    setProgress: (progressMs) => set({ progressMs }),
    setError: (error) => set({ error }),

    setPreviewProgress: (progressMs, durationMs) =>
      set(durationMs > 0 ? { progressMs, engineDurationMs: durationMs } : { progressMs }),

    handleEnded: () => goTo(get().index + 1, true),

    /* ── YouTube ─────────────────────────────────────────────────────────── */

    handleYoutubeState: (phase) => {
      if (get().mode !== "youtube") return;
      switch (phase) {
        case "playing":
          // It made it. Stop the fallback from stealing playback later.
          clearWatchdog();
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
    },

    handleYoutubeError: (message) => {
      clearWatchdog();
      const { tracks, index, isIdle } = get();
      const track = tracks[index];

      // "The uploader doesn't allow this off YouTube" is permanent. Retrying is
      // pointless, so drop this track to its 30-second preview and remember the
      // video, rather than stalling on a play button that will never work.
      if (youtube.isEmbedBlocked(message) && track?.youtubeId) {
        blockedVideos.add(track.youtubeId);
        if (track.previewUrl) {
          set({ mode: "preview", engineDurationMs: 0, isBuffering: !isIdle, error: null });
          preview.load(track.previewUrl);
          if (!isIdle) void preview.play();
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
