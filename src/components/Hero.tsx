"use client";

import { usePlayerStore } from "@/lib/player-store";

/**
 * The stage holds the wordmark and nothing else.
 *
 * Track details live in the player at the bottom, so repeating them here would
 * only split attention between two copies of the same information.
 */
export function Hero() {
  const isIdle = usePlayerStore((s) => s.isIdle);
  const isLoadingCatalogue = usePlayerStore((s) => s.isLoadingCatalogue);

  return (
    <section
      className="stage flex items-center justify-center px-5 sm:px-6"
      aria-label="Melody Wheels"
    >
      <div className="anim-stage flex flex-col items-center text-center">
        <p className="eyebrow mb-4 sm:mb-5">
          {isLoadingCatalogue ? "Tuning in" : "A music player, not a website"}
        </p>

        {/* Roman above, italic below. The mixed setting is the wordmark's whole
            character, and it reads as a choice rather than a default. */}
        <h1 className="wordmark">
          <span className="block">Melody</span>
          <span className="wordmark-italic block">Wheels</span>
        </h1>

        {/* Only while nothing is playing; once it is, the hint is just wrong. */}
        <p
          className={`press-hint mt-6 text-[0.65rem] tracking-[0.3em] text-white/45 uppercase transition-opacity duration-500 sm:mt-7 sm:text-[0.7rem] ${
            isIdle ? "opacity-100" : "opacity-0"
          }`}
        >
          Press play
        </p>
      </div>
    </section>
  );
}
