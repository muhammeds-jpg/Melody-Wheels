/** §31 — the normalized track shape the backend returns. */
export type Track = {
  id: string;
  name: string;
  artist: string;
  album: string;
  image: string;
  /** ms. The REAL track length. */
  duration: number;
  /**
   * ms. Only set when the preview is the audio being played, since a 30-second
   * clip and the track it came from are different lengths and the progress bar
   * must state the one actually playing.
   */
  previewDuration?: number;
  spotifyUrl: string;
  uri: string;
  isPlayable?: boolean;
  /**
   * The YouTube video of this song. This is what plays FULL LENGTH, for every
   * visitor, with no account and no Premium — the reason the site works the way
   * saloon.wtf does. Absent when no confident match was found.
   */
  youtubeId?: string;
  /** The video's own title, kept for debugging a bad match. */
  youtubeTitle?: string;
  /**
   * 30-second preview mp3, straight from Spotify's embed payload. The fallback
   * for a track with no YouTube match. (The official Web API omits this field
   * entirely, which is why it is collected at sync time.)
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

/* ── Minimal YouTube IFrame Player API typings ─────────────────────────────
   Google ships no types for this either; these cover only what is used. */

export type YouTubePlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  /** Loads AND plays. */
  loadVideoById: (videoId: string) => void;
  /** Loads without playing — no sound until playVideo(). */
  cueVideoById: (videoId: string) => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  mute: () => void;
  unMute: () => void;
  /** Seconds. */
  getCurrentTime: () => number;
  /** Seconds. 0 until metadata arrives. */
  getDuration: () => number;
  getPlayerState: () => number;
  destroy: () => void;
};

export type YouTubePlayerVars = {
  controls?: 0 | 1;
  disablekb?: 0 | 1;
  playsinline?: 0 | 1;
  rel?: 0 | 1;
  modestbranding?: 0 | 1;
  fs?: 0 | 1;
  iv_load_policy?: 1 | 3;
  origin?: string;
  start?: number;
};

export type YouTubeNamespace = {
  Player: new (
    container: HTMLElement | string,
    options: {
      videoId?: string;
      playerVars?: YouTubePlayerVars;
      events?: {
        onReady?: (event: { target: YouTubePlayer }) => void;
        onStateChange?: (event: { data: number; target: YouTubePlayer }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YouTubePlayer;
  PlayerState: {
    UNSTARTED: -1;
    ENDED: 0;
    PLAYING: 1;
    PAUSED: 2;
    BUFFERING: 3;
    CUED: 5;
  };
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
    onYouTubeIframeAPIReady?: () => void;
    YT?: YouTubeNamespace;
  }
}
