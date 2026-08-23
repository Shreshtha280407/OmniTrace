"use client";

import { useEffect, useState } from "react";

/**
 * Tracks `prefers-reduced-motion`. Starts false on the server and during the
 * first client render to keep hydration stable, then corrects immediately —
 * every consumer treats the flag as "collapse the animation", so a single
 * frame of motion before it resolves is the worst case.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
