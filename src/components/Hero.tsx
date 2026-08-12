"use client";

import { SITE } from "@/config/tracks";
import { usePlayerStore } from "@/lib/player-store";

/**
 * The stage component.
 *
 * Visual titles were removed per design requirements.
 * Track details live in the player pill at the bottom.
 */
export function Hero() {
  const isLoadingCatalogue = usePlayerStore((s) => s.isLoadingCatalogue);

  // The section carries no aria-label: the heading inside names it, and doing
  // both made a screen reader announce the site's name twice in a row.
  return (
    <section className="stage flex items-center justify-center px-5 sm:px-6">
      <div className="anim-stage flex flex-col items-center text-center">
        {/* The page still needs one heading for screen readers; visible branding is in the video backdrop. */}
        <h1 className="sr-only">{SITE.name}</h1>

        {isLoadingCatalogue && (
          <p className="eyebrow">Tuning in</p>
        )}
      </div>
    </section>
  );
}

