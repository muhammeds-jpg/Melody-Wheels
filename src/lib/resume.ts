/**
 * Where the listener left off, remembered across reloads.
 *
 * Without this, every visit restarts at track one — which is fine for a first
 * arrival and irritating for every one after it.
 *
 * Deliberately NOT restored as autoplay. Browsers refuse to start audio without
 * a gesture, and a page that tried would either be blocked or be rude. The
 * position is restored paused, so the display already reads "2:31 / 4:56" and
 * the first press continues instead of starting over.
 *
 * `localStorage` and not a cookie: it never needs to reach the server, and this
 * way it costs nothing on every request.
 */

const KEY = "mw:resume:v1";

export type ResumePoint = {
  /** Spotify track id — stable across re-syncs of the same playlist. */
  trackId: string;
  positionMs: number;
};

/**
 * Reading and writing both go through try/catch.
 *
 * Access can THROW rather than return null: Safari in private mode throws on
 * write, and storage can be blocked outright by policy. An unguarded call takes
 * the whole player down with it, which is a bad trade for a convenience.
 */
export function readResume(): ResumePoint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const { trackId, positionMs } = parsed as Partial<ResumePoint>;
    if (typeof trackId !== "string" || !trackId) return null;
    if (typeof positionMs !== "number" || !Number.isFinite(positionMs) || positionMs < 0) {
      return null;
    }
    return { trackId, positionMs };
  } catch {
    return null;
  }
}

export function writeResume(point: ResumePoint): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ trackId: point.trackId, positionMs: Math.round(point.positionMs) }),
    );
  } catch {
    // Storage full, blocked, or private mode. Losing the position is harmless.
  }
}

export function clearResume(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * How close to the end still counts as "finished".
 *
 * Resuming with four seconds left is worse than useless — it plays a fragment
 * and immediately advances. Past this, the track restarts from the beginning.
 */
const NEARLY_OVER_MS = 15_000;

/**
 * Turns a stored point into an index and an offset for the CURRENT catalogue.
 *
 * Returns null when the saved track is not in the list — which is exactly what
 * happens after the playlist changes, and is why the track id is stored rather
 * than the index. An index would silently resume at a completely different song.
 */
export function resolveResume(
  point: ResumePoint | null,
  tracks: { id: string; duration: number }[],
): { index: number; positionMs: number } | null {
  if (!point || tracks.length === 0) return null;

  const index = tracks.findIndex((t) => t.id === point.trackId);
  if (index < 0) return null;

  const duration = tracks[index].duration;
  const tooCloseToEnd = duration > 0 && point.positionMs > duration - NEARLY_OVER_MS;

  return { index, positionMs: tooCloseToEnd ? 0 : point.positionMs };
}
