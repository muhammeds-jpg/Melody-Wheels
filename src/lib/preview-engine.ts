/**
 * Real audio, via a single `HTMLAudioElement`.
 *
 * This is what makes the player audible today. `audio-engine.ts` (Spotify Web
 * Playback SDK) is kept alongside it for when the Spotify credentials and a
 * Premium account are in place — the two expose the same shape, so the store
 * switches between them by changing one import.
 *
 * ONE element, created at module scope, never inside the React tree. If the
 * element is constructed in a component, a re-render or a Strict Mode
 * double-mount produces two overlapping audio streams — the single most common
 * bug in this kind of app.
 */

let el: HTMLAudioElement | null = null;

export function getAudio(): HTMLAudioElement {
  if (typeof window === "undefined") throw new Error("audio: server");
  if (!el) {
    el = new Audio();
    el.preload = "metadata";
    // NOTE: crossOrigin is deliberately NOT set. These previews are served
    // without CORS headers; requesting "anonymous" would make the browser
    // refuse them outright. Plain <audio> playback does not need CORS — only
    // the Web Audio API and canvas do.
    el.setAttribute("playsinline", "true"); // iOS: no fullscreen takeover
  }
  return el;
}

export function hasAudio(): boolean {
  return el !== null;
}

export function load(src: string): void {
  const audio = getAudio();
  if (audio.src === src) return;
  audio.src = src;
  audio.load();
}

/**
 * `play()` returns a Promise. An unhandled rejection — autoplay blocked, source
 * swapped mid-play, paused during the await — leaves the UI wedged showing a
 * pause icon over silence, so every call funnels through here.
 */
export function play(): Promise<boolean> {
  const audio = getAudio();
  const result = audio.play();
  if (result === undefined) return Promise.resolve(true); // very old Safari
  return result.then(
    () => true,
    (err: unknown) => {
      // AbortError is expected and benign: it fires whenever a pause or a src
      // change interrupts a pending play().
      if (err instanceof DOMException && err.name === "AbortError") return false;
      console.warn("audio: play() rejected", err);
      return false;
    },
  );
}

export function pause(): void {
  el?.pause();
}

/** Seconds in — the element works in seconds while the store works in ms. */
export function seek(seconds: number): void {
  const audio = getAudio();
  if (!Number.isFinite(seconds)) return;
  try {
    audio.currentTime = Math.max(0, seconds);
  } catch {
    // Seeking before the element is seekable throws in Safari; ignore.
  }
}

export function currentTimeMs(): number {
  return (el?.currentTime ?? 0) * 1000;
}

export function durationMs(): number {
  const d = el?.duration ?? 0;
  return Number.isFinite(d) ? d * 1000 : 0;
}

export function setMuted(muted: boolean): void {
  // `muted` IS writable on iOS; `volume` is not, which is why this app ships
  // mute rather than a volume slider.
  getAudio().muted = muted;
}

export function setVolume(volume: number): void {
  const audio = getAudio();
  try {
    audio.volume = Math.max(0, Math.min(1, volume));
  } catch {
    // iOS Safari: volume is read-only. Mute still works.
  }
}

export type AudioHandlers = {
  onPlay: () => void;
  onPause: () => void;
  onTime: (ms: number) => void;
  onEnded: () => void;
  onWaiting: () => void;
  onError: (message: string) => void;
};

/** Attach once. Returns the detach function. */
export function subscribe(handlers: AudioHandlers): () => void {
  const audio = getAudio();

  let lastTick = 0;
  const onTimeUpdate = () => {
    // Throttle to ~4/sec rather than firing on every native tick.
    const now = performance.now();
    if (now - lastTick < 250) return;
    lastTick = now;
    handlers.onTime(audio.currentTime * 1000);
  };

  const onPlaying = () => handlers.onPlay();
  const onPause = () => handlers.onPause();
  const onEnded = () => handlers.onEnded();
  const onWaiting = () => handlers.onWaiting();
  const onError = () =>
    handlers.onError(audio.error?.message || "This track could not be played.");

  audio.addEventListener("playing", onPlaying);
  audio.addEventListener("pause", onPause);
  audio.addEventListener("timeupdate", onTimeUpdate);
  audio.addEventListener("ended", onEnded);
  audio.addEventListener("waiting", onWaiting);
  audio.addEventListener("error", onError);

  return () => {
    audio.removeEventListener("playing", onPlaying);
    audio.removeEventListener("pause", onPause);
    audio.removeEventListener("timeupdate", onTimeUpdate);
    audio.removeEventListener("ended", onEnded);
    audio.removeEventListener("waiting", onWaiting);
    audio.removeEventListener("error", onError);
  };
}
