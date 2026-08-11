"use client";

import Image from "next/image";
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
      aria-label="Paattu Vandi"
    >
      <div className="anim-stage flex flex-col items-center text-center">
        <p className="eyebrow mb-4 sm:mb-5">
          {isLoadingCatalogue ? "Tuning in" : "A music player, not a website"}
        </p>

        {/* The drawn title logo, not set type. `unoptimized` because the file is
            already a small vector — routing it through the image optimizer would
            rasterise it and cost sharpness for no saving. */}
        <h1 className="leading-none">
          <Image
            src="/Paattu%20vandi%20title%20logo.svg"
            alt="Paattu Vandi"
            width={1738}
            height={535}
            className="wordmark"
            priority
            unoptimized
          />
        </h1>

        {/* Only while nothing is playing; once it is, the hint is just wrong. */}
        <p
          className={`press-hint mt-6 text-[0.65rem] tracking-[0.3em] uppercase transition-opacity duration-500 sm:mt-7 sm:text-[0.7rem] ${
            isIdle ? "opacity-100" : "opacity-0"
          }`}
        >
          Press play
        </p>
      </div>
    </section>
  );
}
