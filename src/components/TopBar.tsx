"use client";

import { useEffect, useState } from "react";
import { SITE } from "@/config/tracks";
import { usePresence } from "@/lib/use-presence";

/** Brand marks, inline so there is no icon font or CDN dependency. */
function SpotifyMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-full w-full" fill="currentColor">
      <path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm5.5 17.3a.75.75 0 0 1-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 1 1-.33-1.46c4.57-1.04 8.5-.59 11.66 1.34.35.22.46.68.25 1.03zm1.47-3.27a.94.94 0 0 1-1.29.31c-3.23-1.98-8.15-2.56-11.97-1.4a.94.94 0 1 1-.54-1.8c4.36-1.32 9.78-.68 13.49 1.6.44.27.58.85.31 1.29zm.13-3.4C15.23 8.33 8.9 8.12 5.2 9.24a1.12 1.12 0 1 1-.65-2.15C8.8 5.8 15.79 6.05 20.2 8.67a1.12 1.12 0 1 1-1.1 1.96z" />
    </svg>
  );
}

function YtMusicMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-full w-full" fill="currentColor">
      <path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm0 19.2a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4zM9.6 8.4l6 3.6-6 3.6V8.4z" />
    </svg>
  );
}

function PlatformLink({
  href,
  label,
  children,
  tint,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
  tint: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} (opens in a new tab)`}
      // 44px minimum touch height via padding, without changing the visual size.
      className="group -my-2 flex items-center gap-1.5 py-2 text-[0.78rem] font-medium text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)] transition-opacity duration-200 hover:opacity-80 sm:gap-2 sm:text-sm"
    >
      <span className={`h-[1.15rem] w-[1.15rem] shrink-0 sm:h-5 sm:w-5 ${tint}`}>
        {children}
      </span>
      {/* The labels are the largest thing in this row; they go first on phones. */}
      <span className="hidden sm:inline">{label}</span>
      <span aria-hidden className="hidden text-xs opacity-70 sm:inline">
        &#8599;
      </span>
    </a>
  );
}

/**
 * Live wall clock. Rendered only after mount: the server's clock is not the
 * visitor's, and rendering it during SSR guarantees a hydration mismatch.
 */
function Clock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      const hour12 = h % 12 === 0 ? 12 : h % 12;
      setTime(`${hour12} ${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`);
    };
    update();
    const timer = window.setInterval(update, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className="text-[0.78rem] font-medium whitespace-nowrap text-white tabular-nums drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)] sm:text-sm">
      {time ?? ""}
    </span>
  );
}

/** Real listener count, from the heartbeat. Renders nothing until it is known. */
function OnlineCount() {
  const count = usePresence();

  // Never render a placeholder or a zero: you are always at least one listener,
  // so a 0 on screen would only ever mean the count is broken.
  if (count === null || count < 1) return null;

  return (
    <div
      className="pointer-events-auto inline-flex shrink-0 items-center gap-1.5 text-[0.78rem] font-medium whitespace-nowrap text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)] sm:gap-2 sm:text-sm"
      aria-live="polite"
    >
      <span className="relative flex h-2.5 w-2.5" aria-hidden>
        <span className="pulse-ring absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.9)]" />
      </span>
      {/* Keyed so the number re-renders cleanly as it changes. */}
      <span key={count} className="anim-fade tabular-nums">
        {count}
      </span>
      {/* First thing dropped on a very narrow phone; the dot and the number
          still say everything that matters. See globals.css. */}
      <span className="online-word text-white/70">{count === 1 ? "listener" : "online"}</span>
    </div>
  );
}

export function TopBar() {
  return (
    // Tighter padding and gaps below sm: the three groups want ~275px and a
    // 280px phone only offers 240px once the old px-5 padding is taken out.
    <header className="pointer-events-none relative z-20 flex items-center justify-between gap-2 px-3 pt-4 sm:gap-4 sm:px-5 sm:pt-5">
      <div className="pointer-events-auto min-w-0 flex-1">
        <Clock />
      </div>

      <OnlineCount />

      <div className="pointer-events-auto flex min-w-0 flex-1 items-center justify-end gap-3 sm:gap-4">
        <PlatformLink href={SITE.spotify} label="Spotify" tint="text-[#1db954]">
          <SpotifyMark />
        </PlatformLink>
        <PlatformLink href={SITE.ytMusic} label="YT Music" tint="text-[#ff0000]">
          <YtMusicMark />
        </PlatformLink>
      </div>
    </header>
  );
}
