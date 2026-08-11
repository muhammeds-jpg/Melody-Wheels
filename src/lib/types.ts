/** §31 — the normalized track shape the backend returns. */
export type Track = {
  id: string;
  name: string;
  artist: string;
  album: string;
  image: string;
  /** ms. The PREVIEW's length — what plays when not signed in. */
  duration: number;
  /**
   * ms. The real track length from Spotify, used in spotify mode. Kept separate
   * so the progress bar always states the duration of whatever is actually
   * playing rather than a number borrowed from the other engine.
   */
  fullDuration?: number;
  spotifyUrl: string;
  uri: string;
  isPlayable?: boolean;
  /**
   * 30-second Apple Music preview. This is what actually produces sound until
   * the Spotify Web Playback SDK is connected — Spotify's Web API returns no
   * audio URL of any kind.
   */
  previewUrl?: string;
};

/** §19 — the player state machine. */
export type PlayerPhase =
  | "INITIALIZING"
  | "LOADING"
  | "READY"
  | "PLAYING"
  | "PAUSED"
  | "ENDED"
  | "ERROR";

/**
 * §27 — user-facing error categories. Raw API errors are never surfaced.
 *
 * `config` is deliberately separate from `spotify`: "Spotify is down" and "you
 * have not added your credentials yet" are completely different problems, and
 * collapsing them sends the reader looking for an outage that isn't happening.
 */
export type PlayerErrorKind =
  | "config"
  | "spotify"
  | "auth"
  | "track"
  | "premium"
  | "browser";

export type PlayerError = { kind: PlayerErrorKind; message: string };

/* ── Minimal Web Playback SDK typings ──────────────────────────────────────
   Spotify ships no official @types package; these cover only what is used. */

export type SpotifyTrackObject = {
  uri: string;
  id: string | null;
  name: string;
  duration_ms?: number;
  artists: { name: string; uri: string }[];
  album: { name: string; uri: string; images: { url: string; height: number; width: number }[] };
};

export type WebPlaybackState = {
  position: number; // ms
  duration: number; // ms
  paused: boolean;
  shuffle: boolean;
  repeat_mode: 0 | 1 | 2;
  track_window: {
    current_track: SpotifyTrackObject;
    previous_tracks: SpotifyTrackObject[];
    next_tracks: SpotifyTrackObject[];
  };
};

export type SpotifySdkError = { message: string };

export type SpotifyPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  activateElement: () => Promise<void>;
  getCurrentState: () => Promise<WebPlaybackState | null>;
  setVolume: (volume: number) => Promise<void>;
  getVolume: () => Promise<number>;
  togglePlay: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  addListener: {
    (event: "ready" | "not_ready", cb: (arg: { device_id: string }) => void): boolean;
    (event: "player_state_changed", cb: (state: WebPlaybackState | null) => void): boolean;
    (event: "autoplay_failed", cb: () => void): boolean;
    (
      event:
        | "initialization_error"
        | "authentication_error"
        | "account_error"
        | "playback_error",
      cb: (err: SpotifySdkError) => void,
    ): boolean;
  };
  removeListener: (event: string) => boolean;
};

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
        enableMediaSession?: boolean;
      }) => SpotifyPlayer;
    };
  }
}
