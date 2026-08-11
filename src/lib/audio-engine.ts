/**
 * §12 — Spotify Web Playback SDK. No iframe embed: the SDK registers a Spotify
 * Connect device in the browser and streams into it, and Pattu Vandi draws its
 * own UI on top.
 *
 * ONE player, created at module scope, never inside the React tree. A second one
 * means two Connect devices fighting over the same account. The guard has to be
 * a cached *promise*, not a null check — `init()` awaits the SDK script, so two
 * concurrent callers (React Strict Mode's double-mount is exactly that) would
 * both sail past `if (player)` before either assigned.
 */
import type { SpotifyPlayer, WebPlaybackState, SpotifySdkError } from "./types";
import { SITE } from "@/config/tracks";

const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";
const API = "https://api.spotify.com/v1";

let player: SpotifyPlayer | null = null;
let deviceId: string | null = null;
let sdkPromise: Promise<void> | null = null;
let initPromise: Promise<SpotifyPlayer> | null = null;
let lastVolume = 1;

export type EngineErrorKind = "initialization" | "authentication" | "account" | "playback";

export type EngineHandlers = {
  onReady: (deviceId: string) => void;
  onNotReady: () => void;
  onState: (state: WebPlaybackState | null) => void;
  onAutoplayFailed: () => void;
  onError: (kind: EngineErrorKind, message: string) => void;
};

export function hasPlayer(): boolean {
  return player !== null;
}

export function getDeviceId(): string | null {
  return deviceId;
}

/**
 * §31 — the browser never holds a refresh token. Every call goes to our own
 * backend, which mints a short-lived access token from the httpOnly cookie.
 */
async function fetchAccessToken(): Promise<string> {
  const res = await fetch("/api/spotify/token", { cache: "no-store" });
  if (!res.ok) throw new Error("not_authenticated");
  const json = (await res.json()) as { accessToken?: string };
  if (!json.accessToken) throw new Error("not_authenticated");
  return json.accessToken;
}

export async function isAuthenticated(): Promise<boolean> {
  try {
    await fetchAccessToken();
    return true;
  } catch {
    return false;
  }
}

function loadSdk(): Promise<void> {
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("spotify: server"));
      return;
    }
    if (window.Spotify) {
      resolve();
      return;
    }

    // The SDK invokes this global itself once it has parsed.
    window.onSpotifyWebPlaybackSDKReady = () => resolve();

    const script = document.createElement("script");
    script.src = SDK_SRC;
    script.async = true;
    script.onerror = () =>
      reject(new Error("Could not load the Spotify player. A blocker may be in the way."));
    document.head.appendChild(script);
  });

  return sdkPromise;
}

async function createPlayer(handlers: EngineHandlers): Promise<SpotifyPlayer> {
  await loadSdk();
  if (!window.Spotify) throw new Error("Spotify SDK loaded but window.Spotify is missing.");

  const p = new window.Spotify.Player({
    name: SITE.name,
    // Called on connect and again on every expiry, so it must fetch a fresh
    // token rather than close over a captured one.
    getOAuthToken: (cb) => {
      void fetchAccessToken().then(cb, (err: unknown) => {
        handlers.onError("authentication", err instanceof Error ? err.message : String(err));
      });
    },
    volume: 1,
    // Gives the lockscreen and hardware keys for free; our own MediaMetadata
    // would only fight the SDK for the same API.
    enableMediaSession: true,
  });

  p.addListener("ready", ({ device_id }) => {
    deviceId = device_id;
    handlers.onReady(device_id);
  });
  p.addListener("not_ready", () => {
    deviceId = null;
    handlers.onNotReady();
  });
  p.addListener("player_state_changed", (state) => handlers.onState(state));
  p.addListener("autoplay_failed", () => handlers.onAutoplayFailed());

  const fail = (kind: EngineErrorKind) => (err: SpotifySdkError) =>
    handlers.onError(kind, err.message);
  p.addListener("initialization_error", fail("initialization"));
  p.addListener("authentication_error", fail("authentication"));
  p.addListener("account_error", fail("account"));
  p.addListener("playback_error", fail("playback"));

  const connected = await p.connect();
  if (!connected) throw new Error("Spotify player refused to connect.");

  player = p;
  return p;
}

/** Idempotent under Strict Mode: repeated calls share one player. */
export function init(handlers: EngineHandlers): Promise<SpotifyPlayer> {
  initPromise ??= createPlayer(handlers).catch((err: unknown) => {
    // Let a later attempt retry rather than caching the failure forever.
    initPromise = null;
    throw err;
  });
  return initPromise;
}

/**
 * §35 — mobile browsers class SDK-initiated playback as autoplay and block it.
 * Must be called from inside a user-gesture task.
 */
export async function activate(): Promise<void> {
  if (!player) return;
  try {
    await player.activateElement();
  } catch {
    // Desktop browsers and older SDK builds do not need it.
  }
}

async function authedPut(path: string, body?: unknown): Promise<void> {
  const token = await fetchAccessToken();
  const res = await fetch(`${API}${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 204 && res.status !== 202) {
    throw new Error(`PUT ${path} -> ${res.status}`);
  }
}

/**
 * Starts the configured catalogue on our device. A bare list of URIs is used
 * rather than a playlist context, because §20's catalogue is app configuration
 * and need not exist as a playlist in anyone's Spotify account.
 */
export async function playUris(uris: string[], offset: number): Promise<void> {
  if (!deviceId) throw new Error("No Spotify device yet — the player is not ready.");
  await authedPut(`/me/player/play?device_id=${deviceId}`, {
    uris,
    offset: { position: offset },
    position_ms: 0,
  });
}

export async function resume(): Promise<boolean> {
  if (!player) return false;
  try {
    await player.resume();
    return true;
  } catch (err) {
    console.warn("spotify: resume failed", err);
    return false;
  }
}

export async function pause(): Promise<void> {
  try {
    await player?.pause();
  } catch (err) {
    console.warn("spotify: pause failed", err);
  }
}

export async function togglePlay(): Promise<void> {
  try {
    await player?.togglePlay();
  } catch (err) {
    console.warn("spotify: togglePlay failed", err);
  }
}

/** Milliseconds in, milliseconds out — §18 keeps progress in ms as Spotify does. */
export async function seek(positionMs: number): Promise<void> {
  if (!player || !Number.isFinite(positionMs)) return;
  try {
    await player.seek(Math.max(0, Math.round(positionMs)));
  } catch (err) {
    console.warn("spotify: seek failed", err);
  }
}

export async function nextTrack(): Promise<void> {
  try {
    await player?.nextTrack();
  } catch (err) {
    console.warn("spotify: nextTrack failed", err);
  }
}

export async function previousTrack(): Promise<void> {
  try {
    await player?.previousTrack();
  } catch (err) {
    console.warn("spotify: previousTrack failed", err);
  }
}

export async function setVolume(volume: number): Promise<void> {
  if (!player) return;
  const clamped = Math.max(0, Math.min(1, volume));
  try {
    await player.setVolume(clamped);
    if (clamped > 0) lastVolume = clamped;
  } catch (err) {
    console.warn("spotify: setVolume failed", err);
  }
}

export async function setMuted(muted: boolean): Promise<void> {
  if (!player) return;
  try {
    if (muted) {
      lastVolume = await player.getVolume().catch(() => 1);
      await player.setVolume(0);
    } else {
      await player.setVolume(lastVolume > 0 ? lastVolume : 1);
    }
  } catch (err) {
    console.warn("spotify: setVolume failed", err);
  }
}

export async function getState(): Promise<WebPlaybackState | null> {
  if (!player) return null;
  return player.getCurrentState().catch(() => null);
}

export function destroy(): void {
  player?.disconnect();
  player = null;
  deviceId = null;
  initPromise = null;
}
