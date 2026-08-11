"use client";

import { useEffect, useRef, useState } from "react";

const HEARTBEAT_MS = 15_000; // half the server's 30s TTL, so we never lapse

/**
 * crypto.randomUUID() only exists in a secure context. Testing from a phone over
 * http://192.168.x.x is not one, and that is exactly where this gets tried — so
 * it needs a fallback or the hook throws on the devices you most want to check.
 */
function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sid-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Live listener count. Returns null until the first response lands, so the UI
 * can render nothing rather than flashing a wrong number.
 */
export function usePresence(): number | null {
  const [count, setCount] = useState<number | null>(null);
  const sidRef = useRef<string | null>(null);

  useEffect(() => {
    // In memory, never localStorage: a second tab is a second listener, and
    // persisting the id would make one person look like one forever.
    if (!sidRef.current) sidRef.current = randomId();
    const sid = sidRef.current;

    let cancelled = false;
    let timer: number | undefined;

    async function beat() {
      try {
        const res = await fetch("/api/presence", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sid }),
          cache: "no-store",
        });
        if (!res.ok) return; // keep the last known count
        const data: unknown = await res.json();
        const next = (data as { count?: unknown }).count;
        if (!cancelled && typeof next === "number") setCount(next);
      } catch {
        // Offline or route down — stay quiet and retry on the next tick.
      }
    }

    function stop() {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    }

    function start() {
      stop();
      void beat();
      timer = window.setInterval(() => void beat(), HEARTBEAT_MS);
    }

    function onVisibility() {
      // A hidden tab is not a listener; stop beating so it drops out of the
      // count, and re-register immediately on return.
      if (document.visibilityState === "hidden") stop();
      else start();
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return count;
}
