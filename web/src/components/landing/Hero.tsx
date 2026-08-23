"use client";

import { motion } from "framer-motion";
import { ArrowRight, ChevronDown } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useWebGLSupport } from "@/hooks/useWebGLSupport";

import { HeroFallback } from "./hero/HeroFallback";

// three/fiber never touches the shared bundle — it arrives only for visitors
// whose device can actually render it.
const HeroScene = dynamic(() => import("./hero/HeroScene"), { ssr: false });

/** Evidence metadata overlaid on the scene. These are illustrative labels for
 *  the composition, not readings from an API — so they are static, four of
 *  them, and they never animate a changing value. */
const CAPTIONS = [
  { text: "video_visual · 02:19.0", tone: "text-modality-visual", pos: "left-[6%] top-[26%]" },
  { text: "ocr_region · p.07", tone: "text-modality-document", pos: "right-[8%] top-[34%]" },
  { text: "utterance · 01:44.2", tone: "text-modality-speech", pos: "left-[13%] bottom-[27%]" },
  { text: "event · confidence 0.91", tone: "text-signal-300", pos: "right-[12%] bottom-[31%]" },
];

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const scrollProgress = useRef(0);
  const webgl = useWebGLSupport();
  const reducedMotion = usePrefersReducedMotion();
  const [scrolled, setScrolled] = useState(false);

  // Scroll is written into a ref and read inside useFrame — driving the scene
  // through React state would re-render the whole hero on every scroll event.
  useEffect(() => {
    const onScroll = () => {
      const height = sectionRef.current?.offsetHeight ?? window.innerHeight;
      const progress = Math.min(1, window.scrollY / (height * 0.85));
      scrollProgress.current = progress;
      setScrolled(progress > 0.04);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const fade = reducedMotion
    ? { initial: { opacity: 1, y: 0 }, animate: { opacity: 1, y: 0 } }
    : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 } };

  return (
    <section
      ref={sectionRef}
      className="grain relative isolate flex min-h-[100svh] flex-col justify-center overflow-hidden bg-ink-950"
      aria-labelledby="hero-heading"
    >
      {/* Scene layer */}
      <div className="pointer-events-none absolute inset-0">
        <div className="grid-field absolute inset-0 opacity-70" aria-hidden />
        {webgl === true && <HeroScene scrollProgress={scrollProgress} />}
        {webgl === false && <HeroFallback />}
        {/* Vignette + horizon wash: keeps the type legible over the scene and
            settles the composition into the page below. */}
        <div
          className="absolute inset-0"
          aria-hidden
          style={{
            background:
              "radial-gradient(120% 78% at 50% 42%, transparent 34%, rgba(6,7,10,0.62) 76%, #06070A 100%)",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink-900 to-transparent" aria-hidden />
      </div>

      {/* Caption labels */}
      <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden>
        {CAPTIONS.map((caption, i) => (
          <motion.span
            key={caption.text}
            initial={reducedMotion ? { opacity: 0.75 } : { opacity: 0 }}
            animate={{ opacity: 0.75 }}
            transition={{ delay: 0.9 + i * 0.16, duration: 0.7 }}
            className={`absolute ${caption.pos} inline-flex items-center gap-1.5 rounded-sm border border-ink-600/60 bg-ink-900/55 px-2 py-1 font-mono text-[10.5px] tabular backdrop-blur-[2px] ${caption.tone}`}
          >
            <span className="size-1 rounded-full bg-current" />
            {caption.text}
          </motion.span>
        ))}
      </div>

      {/* Content */}
      <div className="relative mx-auto w-full max-w-6xl px-6 pb-24 pt-32 sm:px-8">
        <motion.p {...fade} transition={{ duration: 0.6 }} className="eyebrow mb-6">
          Multimodal evidence intelligence
        </motion.p>

        <motion.h1
          id="hero-heading"
          {...fade}
          transition={{ duration: 0.7, delay: 0.06 }}
          className="max-w-4xl text-balance font-display text-display-xl text-ink-50"
        >
          Trace every answer back to the evidence.
        </motion.h1>

        <motion.p
          {...fade}
          transition={{ duration: 0.7, delay: 0.14 }}
          className="mt-7 max-w-xl text-pretty text-[1.0625rem] leading-[1.65] text-ink-200"
        >
          OmniTrace turns video, audio, images, and documents into connected, time-aware evidence — so every AI answer
          can be inspected, verified, and revisited.
        </motion.p>

        <motion.div
          {...fade}
          transition={{ duration: 0.7, delay: 0.22 }}
          className="mt-10 flex flex-wrap items-center gap-3"
        >
          <Button asChild size="lg" variant="primary">
            <Link href="/workspace">
              Open workspace
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#workflow">Explore the system</a>
          </Button>
        </motion.div>

        {/* A statement of what the system stores, not a metrics brag. */}
        <motion.dl
          {...fade}
          transition={{ duration: 0.7, delay: 0.32 }}
          className="mt-16 grid max-w-3xl grid-cols-2 gap-x-8 gap-y-6 border-t border-ink-700/70 pt-8 sm:grid-cols-4"
        >
          {[
            ["Four modalities", "video · audio · image · document"],
            ["Atomic locators", "timestamp · page · bounding box"],
            ["Typed relationships", "directed · scored · versioned"],
            ["Evidence-only answers", "claims cite stored IDs"],
          ].map(([term, detail]) => (
            <div key={term}>
              <dt className="text-ui-xs font-medium text-ink-100">{term}</dt>
              <dd className="mt-1 font-mono text-[10.5px] leading-relaxed text-ink-400">{detail}</dd>
            </div>
          ))}
        </motion.dl>
      </div>

      {/* Scroll affordance — disappears the moment scrolling starts. */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-6 flex justify-center transition-opacity duration-500 ${
          scrolled ? "opacity-0" : "opacity-100"
        }`}
        aria-hidden
      >
        <ChevronDown className="size-4 animate-bounce text-ink-400 motion-reduce:animate-none" />
      </div>
    </section>
  );
}
