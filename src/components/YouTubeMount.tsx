"use client";

import { useEffect, useRef } from "react";
import { usePlayerStore } from "@/lib/player-store";
import * as youtube from "@/lib/youtube-engine";
import { GENERATED_TRACKS } from "@/config/catalogue.generated";

/**
 * Hosts the YouTube iframe that produces the sound.
 *
 * It has to be RENDERED — `display:none`, `visibility:hidden` and a 0×0 box all
 * stop playback outright in Safari and get the frame throttled in Chrome. So it
 * is laid out at a real size, kept on screen, and made transparent instead. It
 * takes no pointer events, so it can never sit between the listener and the
 * player controls above it.
 *
 * Mounted once and never keyed on the track: re-creating the iframe per song
 * would restart the API handshake on every skip.
 */

/**
 * The video cued at startup, read from the committed catalogue rather than from
 * the store.
 *
 * This is what removes the race that made the FIRST song of a session play only
 * 30 seconds: waiting for `/api/tracks` before even constructing the player
 * meant a quick click arrived before the API had connected. The baked list is
 * available synchronously, so the player starts loading with the page.
 */
const BOOTSTRAP_VIDEO_ID = GENERATED_TRACKS.find((t) => t.youtubeId)?.youtubeId ?? "";

export function YouTubeMount() {
  const hostRef = useRef<HTMLDivElement>(null);
  /** Only used when the catalogue was resolved live, so nothing was baked. */
  const liveVideoId = usePlayerStore((s) => s.tracks.find((t) => t.youtubeId)?.youtubeId ?? "");
  const startedRef = useRef(false);

  const videoId = BOOTSTRAP_VIDEO_ID || liveVideoId;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !videoId || startedRef.current) return;
    startedRef.current = true;

    const store = usePlayerStore.getState;

    void youtube
      .mount(host, videoId, {
        onReady: () => store().setYoutubeReady(true),
        onPlay: () => store().handleYoutubeState("playing"),
        onPause: () => store().handleYoutubeState("paused"),
        onBuffering: () => store().handleYoutubeState("buffering"),
        onEnded: () => store().handleYoutubeState("ended"),
        onTime: (positionMs, durationMs) => store().setYoutubeProgress(positionMs, durationMs),
        onError: (message) => store().handleYoutubeError(message),
      })
      .catch(() => {
        // The API script was blocked — an extension, or a strict network. Say so
        // permanently so the store stops waiting and uses the previews.
        store().setYoutubeFailed(true);
      });
  }, [videoId]);

  return (
    <div
      ref={hostRef}
      aria-hidden
      // Bottom-left, behind the pill, fully transparent. z-0 keeps it inside the
      // normal flow — a negative z-index would put it behind body's opaque
      // background, which is what made the artwork disappear once before.
      className="pointer-events-none fixed bottom-0 left-0 z-0 h-[180px] w-[320px] opacity-0"
    />
  );
}
