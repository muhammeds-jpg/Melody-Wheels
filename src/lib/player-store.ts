import { create } from "zustand";
import type { Track, WebPlaybackState } from "./types";
import * as preview from "./preview-engine";
import * as spotify from "./audio-engine";

/**
 * Two playback modes behind one set of controls.
 *
 *  - **spotify** — the Web Playback SDK, streaming FULL tracks. Requires the
 *    listener to connect a Spotify Premium account.
 *  - **preview** — a plain `HTMLAudioElement` on 30-second Apple previews. The
 *    fallback for anyone not signed in, so the site still works for everyone.
 *
 * Every transport action branches on `mode`; nothing above this file needs to
 * know which engine is running.
 */
export type PlaybackMode = "preview" | "spotify";

type PlayerState = {
  tracks: Track[];
  index: number;

  mode: PlaybackMode;
  /** A Spotify session exists; full tracks are possible once the SDK is ready. */
  isConnected: boolean;
  /** The SDK has registered a device and will accept commands. */
  spotifyReady: boolean;

  isLoadingCatalogue: boolean;
  catalogueError: string | null;

  isPlaying: boolean;
  isBuffering: boolean;
  isIdle: boolean;
  progressMs: number;
  muted: boolean;
  error: string | null;

  setTracks: (tracks: Track[]) => void;
  setCatalogueError: (message: string | null) => void;
  setConnected: (connected: boolean) => void;
  setSpotifyReady: (ready: boolean) => void;
  setMode: (mode: PlaybackMode) => void;

  toggle: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (ms: number) => void;
  toggleMute: () => void;

  setPlaying: (playing: boolean) => void;
  setBuffering: (buffering: boolean) => void;
  setProgress: (ms: number) => void;
  setError: (message: string | null) => void;
  handleEnded: () => void;
  /** Mirror of the SDK's player_state_changed. */
  syncFromSpotify: (state: WebPlaybackState | null) => void;
};

/** In spotify mode the full track plays, so its real duration applies. */
function durationOf(track: Track | undefined, mode: PlaybackMode): number {
  if (!track) return 0;
  if (mode === "spotify") return track.fullDuration ?? track.duration;
  return track.duration;
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  /** The single path every track change goes through. */
  function goTo(nextIndex: number, autoplay: boolean) {
    const { tracks, mode } = get();
    if (tracks.length === 0) return;

    const wrapped = ((nextIndex % tracks.length) + tracks.length) % tracks.length;
    const track = tracks[wrapped];

    set({ index: wrapped, progressMs: 0, isIdle: false, error: null, isBuffering: autoplay });

    if (mode === "spotify") {
      // Hand Spotify the whole list from this offset so it can gapless-advance;
      // player_state_changed then keeps `index` in step.
      void spotify
        .playUris(tracks.map((t) => t.uri), wrapped)
        .catch(() => set({ isBuffering: false, error: "Spotify couldn't start that track." }));
      return;
    }

    if (!track.previewUrl) {
      set({ isBuffering: false, isPlaying: false, error: "No audio for this track." });
      return;
    }
    preview.load(track.previewUrl);
    if (autoplay) void preview.play();
  }

  return {
    tracks: [],
    index: 0,
    mode: "preview",
    isConnected: false,
    spotifyReady: false,

    isLoadingCatalogue: true,
    catalogueError: null,

    isPlaying: false,
    isBuffering: false,
    isIdle: true,
    progressMs: 0,
    muted: false,
    error: null,

    setTracks: (tracks) =>
      set({ tracks, index: 0, isLoadingCatalogue: false, catalogueError: null }),

    setCatalogueError: (catalogueError) => set({ catalogueError, isLoadingCatalogue: false }),

    setConnected: (isConnected) => set({ isConnected }),

    setSpotifyReady: (spotifyReady) =>
      set((s) => ({
        spotifyReady,
        // Only switch once the device is actually registered, or the first
        // press would be sent to a player that cannot answer.
        mode: spotifyReady ? "spotify" : s.mode === "spotify" ? "preview" : s.mode,
      })),

    toggle: () => {
      const { isPlaying, isIdle, tracks, index, mode } = get();
      if (tracks.length === 0) return;

      if (mode === "spotify") {
        // The first press must start a context; togglePlay on an idle device
        // does nothing.
        if (isIdle) {
          set({ isIdle: false, isBuffering: true, error: null });
          void spotify
            .activate() // must run inside the gesture, or mobile blocks it
            .then(() => spotify.playUris(tracks.map((t) => t.uri), index))
            .catch(() => set({ isBuffering: false, error: "Spotify couldn't start playback." }));
          return;
        }
        void spotify.togglePlay();
        return;
      }

      if (isIdle) {
        const track = tracks[index];
        if (!track?.previewUrl) {
          set({ error: "No audio for this track." });
          return;
        }
        set({ isIdle: false, isBuffering: true, error: null });
        preview.load(track.previewUrl);
        void preview.play().then((ok) => {
          if (!ok) set({ isBuffering: false });
        });
        return;
      }

      if (isPlaying) preview.pause();
      else void preview.play();
    },

    next: () => {
      if (get().mode === "spotify") {
        void spotify.nextTrack();
        return;
      }
      goTo(get().index + 1, !get().isIdle);
    },

    prev: () => {
      // Standard behaviour: restart the track if we are more than 3s in.
      if (get().progressMs > 3000) {
        if (get().mode === "spotify") void spotify.seek(0);
        else preview.seek(0);
        set({ progressMs: 0 });
        return;
      }
      if (get().mode === "spotify") {
        void spotify.previousTrack();
        return;
      }
      goTo(get().index - 1, !get().isIdle);
    },

    seekTo: (ms) => {
      const { tracks, index, mode } = get();
      const duration = durationOf(tracks[index], mode);
      const clamped = Math.max(0, Math.min(ms, duration || ms));
      set({ progressMs: clamped }); // optimistic: keeps the thumb under the finger
      if (mode === "spotify") void spotify.seek(clamped);
      else preview.seek(clamped / 1000);
    },

    toggleMute: () => {
      const muted = !get().muted;
      set({ muted });
      if (get().mode === "spotify") void spotify.setMuted(muted);
      else preview.setMuted(muted);
    },

    setMode: (mode) => set({ mode }),

    setPlaying: (isPlaying) => set({ isPlaying, isBuffering: false, isIdle: false }),
    setBuffering: (isBuffering) => set({ isBuffering }),
    setProgress: (progressMs) => set({ progressMs }),
    setError: (error) => set({ error }),

    handleEnded: () => goTo(get().index + 1, true),

    syncFromSpotify: (state) => {
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
        error: null,
      });
    },
  };
});

export function useCurrentTrack(): Track | null {
  return usePlayerStore((s) => s.tracks[s.index] ?? null);
}

export function useDurationMs(): number {
  return usePlayerStore((s) => durationOf(s.tracks[s.index], s.mode));
}
