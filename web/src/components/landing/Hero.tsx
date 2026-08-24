"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

import { HeroProduct } from "./hero/HeroProduct";

/**
 * Hero.
 *
 * Proportions are taken from the reference set rather than invented: a long
 * run of quiet space, one large headline, a subtitle held to two lines, two
 * actions, then the product itself — bleeding off the bottom edge so the page
 * reads as continuing rather than ending.
 *
 * Three things were removed on purpose, because together they were what made
 * the page read as a template:
 *
 *  - The WebGL constellation. Wireframe spheres and floating diamonds are
 *    decorative geometry; the reference set shows product UI, a soft glow, or
 *    a single restrained material object, never glowing outlines.
 *  - The four-column spec table. None of the references put a spec grid in the
 *    hero — it turns an opening statement into a brochure, and the walkthrough
 *    below already makes every one of those points properly.
 *  - The solid mint CTA. The teal is a *data encoding* in this system: it means
 *    evidence and provenance. Spending it on a marketing button both dilutes
 *    that meaning and is the loudest thing on the page. The reference set's
 *    primary CTAs are white, black, or near-black — the accent is never the
 *    biggest object in the composition.
 */
export function Hero() {
  const reducedMotion = usePrefersReducedMotion();

  const fade = reducedMotion
    ? { initial: { opacity: 1, y: 0 }, animate: { opacity: 1, y: 0 } }
    : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };

  return (
    <section
      className="relative isolate overflow-hidden bg-ink-950 pb-0 pt-28 sm:pt-36"
      aria-labelledby="hero-heading"
    >
      {/* Ambient ground. Two wide, very low-opacity pools plus a hairline grid
          that fades out before it reaches the type. No moving parts. */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(70% 45% at 50% -8%, rgba(25,214,196,0.10), transparent 62%), radial-gradient(50% 38% at 88% 6%, rgba(122,109,201,0.08), transparent 68%)",
          }}
        />
        <div
          className="grid-field absolute inset-0 opacity-60"
          style={{ maskImage: "radial-gradient(70% 55% at 50% 0%, #000 20%, transparent 78%)" }}
        />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-ink-900 to-transparent" />
      </div>

      <div className="mx-auto w-full max-w-6xl px-6 sm:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <motion.p {...fade} transition={{ duration: 0.6 }}>
            <span className="inline-flex items-center gap-2 rounded-full border border-ink-600/80 bg-ink-900/60 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-300 backdrop-blur-sm">
              <span className="size-1.5 rounded-full bg-signal-500" aria-hidden />
              Multimodal evidence intelligence
            </span>
          </motion.p>

          <motion.h1
            id="hero-heading"
            {...fade}
            transition={{ duration: 0.7, delay: 0.06 }}
            className="mt-7 text-balance font-display text-display-xl text-ink-50"
          >
            Trace every answer back to the evidence.
          </motion.h1>

          <motion.p
            {...fade}
            transition={{ duration: 0.7, delay: 0.14 }}
            className="mx-auto mt-6 max-w-2xl text-pretty text-[1.0625rem] leading-[1.6] text-ink-200"
          >
            Video, audio, images and documents become one connected, time-aware body of evidence — so every answer can
            be opened at the exact frame, page or region it came from.
          </motion.p>

          <motion.div
            {...fade}
            transition={{ duration: 0.7, delay: 0.22 }}
            className="mt-9 flex flex-wrap items-center justify-center gap-3"
          >
            <Button asChild size="lg" variant="marketing">
              <Link href="/workspace">
                Open workspace
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#workflow">Explore the system</a>
            </Button>
          </motion.div>
        </div>

        {/* The product. Cropped by the section's bottom edge on purpose. */}
        <div className="mt-16 sm:mt-20">
          <HeroProduct />
        </div>
      </div>
    </section>
  );
}
