"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils";

import {
  AnswerVisual,
  AtomicVisual,
  IngestVisual,
  RetrievalVisual,
  SegmentVisual,
  TimelineVisual,
} from "./walkthrough/visuals";

/**
 * The guided product story.
 *
 * A left rail of numbered steps, a sticky visual stage, and scroll-driven
 * step activation. Three things make it usable rather than merely cinematic:
 *
 *  - The rail buttons are real controls. Clicking one scrolls to that step;
 *    they are keyboard reachable and expose `aria-current`.
 *  - Under reduced motion, and on small screens, the whole thing degrades to
 *    a plain stacked list where every visual is simply present. There is no
 *    content that only exists inside a scroll animation.
 *  - Step activation is driven by IntersectionObserver against the step
 *    panels, not by a scroll-position calculation that drifts as the page
 *    reflows.
 */

const STEPS = [
  {
    id: "ingest",
    title: "Ingest the original",
    body: "Every file is hashed on arrival. The content fingerprint is the source's identity, so re-uploading identical bytes resolves to the existing record instead of duplicating it. Modality, duration and page count are probed before a single derived object is written.",
    Visual: IngestVisual,
  },
  {
    id: "atomic",
    title: "Preserve atomic proof",
    body: "Utterances, OCR regions, stable visual states and document blocks are stored as individual observations, each keeping the exact locator it was found at — a millisecond range, or a page and a normalised bounding box. Nothing is flattened into an undifferentiated text chunk.",
    Visual: AtomicVisual,
  },
  {
    id: "context",
    title: "Build semantic context",
    body: "Related observations are grouped into retrieval-ready segments sized for meaning rather than for a token budget. The segment is a new object with its own embedding; the observations underneath it stay individually addressable, so retrieval context never overwrites proof.",
    Visual: SegmentVisual,
  },
  {
    id: "connect",
    title: "Connect evidence in time",
    body: "Candidate pairs are scored on temporal, entity, semantic and provenance signals, then written as typed, directed, versioned relationships. A timeline guard prevents two unrelated recordings from aligning just because both have something at 00:30. Confirmed edges cluster into semantic events.",
    Visual: TimelineVisual,
  },
  {
    id: "retrieve",
    title: "Retrieve the full bundle",
    body: "Four seed channels run in parallel — lexical, text-vector, visual-vector and structured — and are fused with weighted reciprocal-rank fusion rather than compared on incomparable score scales. Bounded graph expansion follows confirmed edges only, and the bundle is reranked against the question's answer slots.",
    Visual: RetrievalVisual,
  },
  {
    id: "answer",
    title: "Answer with provenance",
    body: "Generation sees only the retrieved bundle and may cite only IDs inside it. Locators are attached afterwards from the stored record, never restated by the model — which is what makes a citation openable at the original frame, page or region. Gaps are reported as gaps.",
    Visual: AnswerVisual,
  },
];

export function Walkthrough() {
  const [active, setActive] = useState(0);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const nodes = stepRefs.current.filter(Boolean) as HTMLDivElement[];
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to the middle of the viewport rather than the
        // first intersecting one — with a sticky stage, several are visible.
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const best = visible.reduce((a, b) =>
          Math.abs(a.boundingClientRect.top + a.boundingClientRect.height / 2 - window.innerHeight / 2) <
          Math.abs(b.boundingClientRect.top + b.boundingClientRect.height / 2 - window.innerHeight / 2)
            ? a
            : b,
        );
        const index = nodes.indexOf(best.target as HTMLDivElement);
        if (index >= 0) setActive(index);
      },
      { rootMargin: "-35% 0px -35% 0px", threshold: [0, 0.5, 1] },
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const jumpTo = useCallback(
    (index: number) => {
      stepRefs.current[index]?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "center",
      });
      setActive(index);
    },
    [reducedMotion],
  );

  const ActiveVisual = STEPS[active].Visual;

  return (
    <section id="workflow" className="relative border-t border-ink-800 bg-ink-900 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-6 sm:px-8">
        <header className="mb-16 max-w-2xl">
          <p className="eyebrow mb-4">The workflow</p>
          <h2 className="text-balance font-display text-display-lg text-ink-50">
            From an original file to a defensible answer, in six steps.
          </h2>
          <p className="mt-5 text-pretty text-ui-lg leading-relaxed text-ink-300">
            Each step produces a durable object the next one builds on. Nothing is discarded along the way, which is
            what makes the last step reversible all the way back to the first.
          </p>
        </header>

        <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
          {/* ── step rail ─────────────────────────────────────────── */}
          <nav aria-label="Workflow steps" className="hidden lg:block">
            <ol className="sticky top-24 space-y-0.5">
              {STEPS.map((step, i) => (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={() => jumpTo(i)}
                    aria-current={active === i ? "step" : undefined}
                    className={cn(
                      "group relative flex w-full items-start gap-3 rounded-md py-2.5 pl-4 pr-2 text-left transition-colors duration-200",
                      active === i ? "text-ink-50" : "text-ink-400 hover:text-ink-200",
                    )}
                  >
                    {/* active indicator rides the rail */}
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-0 top-2.5 w-px bg-signal-500 transition-all duration-300 ease-state",
                        active === i ? "h-[calc(100%-1.25rem)] opacity-100" : "h-0 opacity-0",
                      )}
                    />
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-0 top-2.5 h-[calc(100%-1.25rem)] w-px transition-colors",
                        active === i ? "bg-transparent" : "bg-ink-700 group-hover:bg-ink-600",
                      )}
                    />
                    <span
                      className={cn(
                        "mt-px shrink-0 font-mono text-ui-2xs tabular transition-colors",
                        active === i ? "text-signal-400" : "text-ink-500",
                      )}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-ui-sm font-medium leading-snug">{step.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          {/* ── content ───────────────────────────────────────────── */}
          <div className="lg:grid lg:grid-cols-2 lg:gap-10">
            {/* copy column — the scroll driver */}
            <div>
              {STEPS.map((step, i) => (
                <div
                  key={step.id}
                  ref={(el) => {
                    stepRefs.current[i] = el;
                  }}
                  id={`step-${step.id}`}
                  className="flex min-h-[min(78vh,640px)] flex-col justify-center py-10 lg:py-0"
                >
                  <div
                    className={cn(
                      "transition-opacity duration-500",
                      // On large screens inactive steps recede; on small ones
                      // everything stays fully legible. 40% dropped the body
                      // copy to roughly 2.5:1 — receding is meant to rank the
                      // steps, not to make the inactive ones unreadable for
                      // anyone who scrolls at their own pace.
                      "lg:opacity-[0.62]",
                      active === i && "lg:opacity-100",
                    )}
                  >
                    <p className="mb-3 font-mono text-ui-2xs tabular text-signal-400 lg:hidden">
                      {String(i + 1).padStart(2, "0")}
                    </p>
                    <h3 className="text-balance font-display text-display-md text-ink-50">{step.title}</h3>
                    <p className="mt-4 max-w-md text-pretty text-ui-base leading-[1.75] text-ink-300">{step.body}</p>
                  </div>

                  {/* Visual inline on small screens, where there is no stage. */}
                  <div className="mt-8 lg:hidden">
                    <div className="aspect-[4/3] w-full">
                      <step.Visual active />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* sticky stage — large screens only */}
            <div className="hidden lg:block">
              {/* The copy step is 78vh tall and centres its text, so the active
                  copy always sits on the viewport's midline. Pinning the stage
                  at a fixed 6rem put its centre ~36vh up from that line, and
                  the two columns visibly failed to relate to each other. 14vh
                  + half of 66vh lands the stage centre on 50vh too. */}
              <div className="sticky top-[14vh] h-[min(66vh,560px)]">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={STEPS[active].id}
                    initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reducedMotion ? { opacity: 1 } : { opacity: 0, y: -12 }}
                    transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                    className="h-full"
                  >
                    <ActiveVisual active />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
