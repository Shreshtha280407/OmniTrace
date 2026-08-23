"use client";

import { useEffect, useState } from "react";

/**
 * Detects usable WebGL2. Returns `null` while undetermined so callers can hold
 * the layout rather than flashing the fallback and then swapping to a canvas.
 *
 * The context is created on a throwaway canvas and explicitly released — a
 * leaked probe context counts against the browser's small per-page limit and
 * can starve the real scene.
 */
export function useWebGLSupport(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    let ok = false;
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      ok = Boolean(gl);
      const lose = (gl as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context");
      lose?.loseContext();
    } catch {
      ok = false;
    }
    setSupported(ok);
  }, []);

  return supported;
}

/**
 * True while the element is anywhere near the viewport. Heavy WebGL is
 * suspended when this goes false, so a scrolled-past hero stops consuming
 * frames instead of rendering into a compositor no one is looking at.
 */
export function useInViewport(ref: React.RefObject<Element>, rootMargin = "200px"): boolean {
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  return inView;
}
