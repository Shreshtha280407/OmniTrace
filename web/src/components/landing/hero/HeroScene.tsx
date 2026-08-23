"use client";

import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useInViewport } from "@/hooks/useWebGLSupport";

import { EvidenceConstellation } from "./EvidenceConstellation";

/**
 * WebGL host for the hero.
 *
 * Dynamically imported by Hero.tsx so three/fiber never enters the shared
 * bundle. Rendering is suspended whenever the hero leaves the viewport or the
 * tab is hidden, and the frameloop is demand-driven under reduced motion — a
 * static composed frame instead of a still-running render loop.
 */

export interface HeroSceneProps {
  /** Written by the parent on scroll; read inside useFrame without re-render. */
  scrollProgress: React.MutableRefObject<number>;
}

export default function HeroScene({ scrollProgress }: HeroSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const reducedMotion = usePrefersReducedMotion();
  const inView = useInViewport(containerRef, "120px");
  const tabVisible = useDocumentVisible();

  // Pointer is tracked on the window rather than the canvas so parallax keeps
  // responding while the cursor is over the headline and buttons.
  useEffect(() => {
    if (reducedMotion) return;
    const onMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = -((event.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reducedMotion]);

  const active = inView && tabVisible;

  return (
    <div ref={containerRef} className="absolute inset-0" aria-hidden>
      <Canvas
        // `demand` under reduced motion renders one frame and stops.
        frameloop={reducedMotion ? "demand" : active ? "always" : "never"}
        camera={{ position: [0, 0.08, 5.6], fov: 42, near: 0.1, far: 40 }}
        // Cap DPR: this scene is fill-rate bound on the additive sprite, and
        // 3× on a phone buys nothing visible.
        dpr={[1, 1.75]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          // Avoids a needless full-canvas readback on every frame.
          preserveDrawingBuffer: false,
        }}
        style={{ background: "transparent" }}
      >
        <EvidenceConstellation scrollProgress={scrollProgress} pointer={pointer} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
}

/** A backgrounded tab should not be rendering WebGL. */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    onChange();
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}
