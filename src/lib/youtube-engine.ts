/**
 * FULL-LENGTH playback for every visitor, with no account of any kind.
 *
 * This is the engine the site actually runs on, and the reason it behaves like
 * saloon.wtf: open the page, press play, hear the whole song. No login, no
 * Premium, no API key — the IFrame Player API needs none of those. (Only
 * *searching* YouTube needs a key, and that happens offline in `npm run sync`.)
 *
 * ONE player, created at module scope. If the player were built inside a
 * component, React Strict Mode's double-mount would produce two iframes playing
 * over each other. The API script load is guarded by a cached Promise rather
 * than a null check, because two calls landing in the same tick would otherwise
 * both start appending the script tag.
 */
import type { YouTubeNamespace, YouTubePlayer } from "./types";

/* ── the API script ──────────────────────────────────────────────────────── */

let apiPromise: Promise<YouTubeNamespace> | null = null;

function loadApi(): Promise<YouTubeNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("youtube: server"));
  if (window.YT?.Player) return Promise.resolve(window.YT);

  apiPromise ??= new Promise<YouTubeNamespace>((resolve, reject) => {
    // The API calls exactly one global hook. Chain any existing one rather than
    // overwriting it, so this never silently breaks another embed on the page.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
      else reject(new Error("youtube: API ready but YT is missing"));
    };

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      apiPromise = null; // let a later attempt retry
      reject(new Error("youtube: iframe_api failed to load"));
    };
    document.head.appendChild(script);
  });

  return apiPromise;
}

/* ── the player ──────────────────────────────────────────────────────────── */

export type YouTubeHandlers = {
  onReady: () => void;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
  onBuffering: () => void;
  /** Fires ~4x/sec while playing. Both values are ms. */
  onTime: (positionMs: number, durationMs: number) => void;
  onError: (message: string) => void;
};

let player: YouTubePlayer | null = null;
let playerPromise: Promise<YouTubePlayer> | null = null;
let handlers: YouTubeHandlers | null = null;
let ticker: number | null = null;

/** What we asked for, so a play() arriving before onReady is not lost. */
let pending: { videoId: string; autoplay: boolean } | null = null;
let currentVideoId = "";
/**
 * Has this player ever actually produced playback?
 *
 * The video cued at mount sits in CUED state, and `playVideo()` on it is not
 * reliable — it can silently do nothing, leaving the transport showing Pause
 * over a frozen 0:00. `loadVideoById` always works, so the FIRST start goes
 * through that instead. After that `playVideo()` is correct, because reloading
 * would restart the track rather than resuming it.
 */
let hasPlayed = false;

export function hasEverPlayed(): boolean {
  return hasPlayed;
}

/**
 * YouTube's own error codes. 101/150 are the ones that actually bite: the
 * uploader disallowed embedding, so this video will never play here no matter
 * how many times it is retried — the store has to move on to the next track.
 */
const ERROR_COPY: Record<number, string> = {
  2: "That video id was rejected.",
  5: "This video can't play in this browser.",
  100: "That video was removed from YouTube.",
  101: "The uploader doesn't allow this video off YouTube.",
  150: "The uploader doesn't allow this video off YouTube.",
};

/** True when the failure means "never going to work", not "try again". */
export function isEmbedBlocked(message: string): boolean {
  return message === ERROR_COPY[101] || message === ERROR_COPY[100];
}

function startTicker() {
  if (ticker !== null) return;
  ticker = window.setInterval(() => {
    if (!player || !handlers) return;
    // These throw if the iframe was torn down mid-flight.
    try {
      const position = player.getCurrentTime?.() ?? 0;
      const duration = player.getDuration?.() ?? 0;
      handlers.onTime(position * 1000, duration * 1000);
    } catch {
      /* the next tick will find it gone */
    }
  }, 250);
}

function stopTicker() {
  if (ticker === null) return;
  window.clearInterval(ticker);
  ticker = null;
}

/**
 * Builds the player inside `container`. Safe to call repeatedly — later calls
 * return the same player.
 *
 * The player is created with the first video already loaded but NOT playing, so
 * that by the time the listener presses play the iframe exists and `playVideo()`
 * runs inside their click. Creating it lazily on first press instead loses the
 * gesture to the async script load, and mobile browsers then refuse the audio.
 */
export function mount(
  container: HTMLElement,
  videoId: string,
  next: YouTubeHandlers,
): Promise<YouTubePlayer> {
  handlers = next;
  if (playerPromise) return playerPromise;

  playerPromise = loadApi().then(
    (YT) =>
      new Promise<YouTubePlayer>((resolve) => {
        currentVideoId = videoId;
        const instance = new YT.Player(container, {
          videoId,
          // Same set saloon.wtf uses: no chrome, no keyboard, no related videos,
          // and playsinline so iOS doesn't hijack the screen with a fullscreen
          // video player the moment audio starts.
          playerVars: {
            controls: 0,
            disablekb: 1,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            fs: 0,
            iv_load_policy: 3,
            // Silences the postMessage origin warnings in the console.
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              player = instance;
              handlers?.onReady();
              // Honour anything requested while the API was still loading.
              if (pending) {
                const { videoId: id, autoplay } = pending;
                pending = null;
                load(id, autoplay);
              }
              resolve(instance);
            },
            onStateChange: (event) => {
              const state = window.YT?.PlayerState;
              if (!state || !handlers) return;
              switch (event.data) {
                case state.PLAYING:
                  hasPlayed = true;
                  handlers.onPlay();
                  startTicker();
                  break;
                case state.PAUSED:
                  stopTicker();
                  handlers.onPause();
                  break;
                case state.BUFFERING:
                  handlers.onBuffering();
                  break;
                case state.ENDED:
                  stopTicker();
                  handlers.onEnded();
                  break;
                default:
                  break;
              }
            },
            onError: (event) => {
              stopTicker();
              handlers?.onError(ERROR_COPY[event.data] ?? "This video could not be played.");
            },
          },
        });
      }),
  );

  return playerPromise;
}

export function isReady(): boolean {
  return player !== null;
}

/** Swap the video. `autoplay` false cues it without making a sound. */
export function load(videoId: string, autoplay: boolean): void {
  if (!player) {
    pending = { videoId, autoplay };
    return;
  }
  currentVideoId = videoId;
  try {
    if (autoplay) player.loadVideoById(videoId);
    else player.cueVideoById(videoId);
  } catch {
    pending = { videoId, autoplay };
  }
}

export function currentVideo(): string {
  return currentVideoId;
}

export function play(): void {
  try {
    player?.playVideo();
  } catch {
    /* not ready yet */
  }
}

export function pause(): void {
  try {
    player?.pauseVideo();
  } catch {
    /* not ready yet */
  }
}

/** Seconds — the store works in ms, the player in seconds. */
export function seek(seconds: number): void {
  if (!Number.isFinite(seconds)) return;
  try {
    // `true` lets it seek ahead of what is buffered instead of waiting.
    player?.seekTo(Math.max(0, seconds), true);
  } catch {
    /* not ready yet */
  }
}

export function setMuted(muted: boolean): void {
  try {
    if (muted) player?.mute();
    else player?.unMute();
  } catch {
    /* not ready yet */
  }
}

export function durationMs(): number {
  try {
    return (player?.getDuration?.() ?? 0) * 1000;
  } catch {
    return 0;
  }
}
