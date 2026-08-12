"use client";

import { useState, useRef, useEffect } from "react";
import { Heart } from "lucide-react";

export function CreditsWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 200);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen((prev) => !prev);
  };

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (widgetRef.current && !widgetRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div
      ref={widgetRef}
      className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 pointer-events-auto"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Floating Credits Card */}
      <div
        className={`absolute bottom-full right-0 mb-3 transition-all duration-300 ease-out transform origin-bottom-right ${
          isOpen
            ? "opacity-100 translate-y-0 scale-100 pointer-events-auto"
            : "opacity-0 translate-y-2 scale-95 pointer-events-none"
        }`}
      >
        <div className="relative rounded-2xl bg-[#241813]/92 backdrop-blur-xl px-4 py-3 border border-white/15 shadow-[0_12px_40px_rgba(0,0,0,0.6)] flex flex-col items-center text-center gap-1 min-w-[220px] whitespace-nowrap">
          <p className="text-[0.75rem] sm:text-xs font-semibold tracking-wide text-white/95 drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
            &copy; Syntellite Innovation Pvt. Ltd.
          </p>
          <p className="text-[0.68rem] sm:text-[0.72rem] text-white/75 font-normal tracking-wider">
            Developed by{" "}
            <span className="text-white font-medium">Akhil</span>
            <span className="text-[#c2603f] font-semibold mx-1.5">|</span>
            <span className="text-white font-medium">Shamsheer</span>
            <span className="text-[#c2603f] font-semibold mx-1.5">|</span>
            <span className="text-white font-medium">Arya</span>
          </p>

          {/* Little pointer arrow */}
          <div
            className="absolute -bottom-1.5 right-4 w-3 h-3 bg-[#241813]/92 border-r border-b border-white/15 transform rotate-45"
            aria-hidden
          />
        </div>
      </div>

      {/* Heart Toggle Button */}
      <button
        type="button"
        onClick={handleClick}
        aria-label="View developer credits"
        aria-expanded={isOpen}
        className="group relative flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-[#241813]/85 backdrop-blur-md border border-white/15 text-[#c2603f] hover:text-[#d97350] shadow-[0_6px_24px_rgba(0,0,0,0.5)] transition-all duration-300 hover:scale-110 hover:border-[#c2603f]/40 hover:bg-[#241813]/95 active:scale-95 focus-visible:outline-none"
      >
        <Heart
          className={`h-5 w-5 transition-all duration-300 ${
            isOpen
              ? "fill-[#c2603f] text-[#c2603f] scale-110 drop-shadow-[0_0_8px_rgba(194,96,63,0.6)]"
              : "text-[#c2603f]/80 group-hover:text-[#c2603f] group-hover:scale-110 group-hover:fill-[#c2603f]/30"
          }`}
        />
        {/* Warm Terracotta Glow halo on hover/active */}
        <span
          className={`absolute inset-0 rounded-full bg-[#c2603f]/30 blur-md transition-opacity duration-300 ${
            isOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          aria-hidden
        />
      </button>
    </div>
  );
}
