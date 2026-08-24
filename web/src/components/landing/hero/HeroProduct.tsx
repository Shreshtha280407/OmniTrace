"use client";

import { motion } from "framer-motion";

import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

/**
 * The hero visual: the product, not a metaphor for it.
 *
 * This replaced a WebGL constellation of wireframe spheres, floating diamonds
 * and tilted outlined planes. That composition was the single thing making the
 * page read as a template — decorative low-poly geometry is the visual
 * vocabulary of a game menu, and no serious developer tool uses it. Linear
 * shows a screenshot of the app; Vercel shows a soft grayscale glow; Resend
 * shows one dark photoreal object. All three are materially restrained and
 * none of them draw a glowing wireframe.
 *
 * Rendering it in the DOM rather than shipping a PNG keeps it sharp at every
 * DPI, keeps it responsive, and — because it consumes the same design tokens
 * as the real workspace — keeps it honest: if the product's evidence chip
 * changes shape, this changes with it.
 */

const EVIDENCE = [
  { kind: "utterance", locator: "01:44.2", color: "var(--modality-speech)", label: "Speech" },
  { kind: "visual_state", locator: "02:19.0", color: "var(--modality-visual)", label: "Video" },
  { kind: "ocr_region", locator: "bbox", color: "var(--modality-image)", label: "Image" },
  { kind: "document_block", locator: "p.07", color: "var(--modality-document)", label: "Document" },
];

export function HeroProduct() {
  const reduced = usePrefersReducedMotion();

  return (
    <motion.div
      initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="relative mx-auto w-full max-w-5xl"
    >
      {/* Ambient lift behind the frame — a soft pool of light, not a glow
          outline. Keeps the panel from looking pasted onto the background. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-16 -top-10 bottom-0 -z-10"
        style={{
          background:
            "radial-gradient(58% 60% at 50% 30%, rgba(25,214,196,0.10), transparent 70%), radial-gradient(45% 50% at 78% 10%, rgba(122,109,201,0.08), transparent 72%)",
        }}
      />

      <div className="overflow-hidden rounded-2xl border border-ink-600/80 bg-ink-850/90 shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_40px_120px_-40px_rgba(0,0,0,1)] backdrop-blur-sm">
        {/* window strip */}
        <div className="flex items-center gap-3 border-b border-ink-600/70 bg-ink-800/60 px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="size-2 rounded-full bg-ink-600" />
            <span className="size-2 rounded-full bg-ink-600" />
            <span className="size-2 rounded-full bg-ink-600" />
          </span>
          <span className="font-mono text-[11px] tabular text-ink-400">demo_architecture</span>
          <span className="ml-auto font-mono text-[11px] tabular text-ink-400">4 sources · 1.24s</span>
        </div>

        <div className="grid gap-px bg-ink-600/40 sm:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          {/* ── answer pane ─────────────────────────────────────────── */}
          <div className="bg-ink-850 p-5 sm:p-6">
            <p className="text-[13px] leading-relaxed text-ink-300">
              What architecture was proposed to reduce database load, who explained it, and where was it shown?
            </p>

            <div className="mt-4 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-validated-500/40 bg-validated-900/60 px-2 py-0.5 text-[11px] font-medium text-validated-400">
                <span className="size-1.5 rounded-full bg-validated-500" aria-hidden />
                Well supported
              </span>
              <span className="font-mono text-[11px] tabular text-ink-400">3 claims · 4 evidence</span>
            </div>

            {/* The citation markers are glued to the preceding word with no
                JSX whitespace between them — a newline in JSX collapses to a
                real space, which let a marker wrap onto a line of its own and
                read as a layout fault. */}
            <p className="mt-4 text-[14px] leading-[1.75] text-ink-50">
              {"A Redis read-through cache was proposed in front of the primary Postgres instance"}
              <Cite n={1} />
              {", explained during the design review"}
              <Cite n={2} />
              {", and shown on the architecture diagram on screen"}
              <Cite n={3} />
              {"."}
            </p>

            <div className="mt-5 border-t border-ink-600/60 pt-4">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">
                Missing information
              </p>
              <p className="text-[12.5px] leading-relaxed text-ink-300">
                No measured p99 latency after deployment appears in any source.
              </p>
            </div>
          </div>

          {/* ── evidence pane ───────────────────────────────────────── */}
          <div className="bg-ink-850 p-5 sm:p-6">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">Evidence bundle</p>
            <ul className="space-y-2">
              {EVIDENCE.map((e, i) => (
                <motion.li
                  key={e.kind}
                  initial={reduced ? { opacity: 1 } : { opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: 0.8 + i * 0.09, ease: [0.16, 1, 0.3, 1] }}
                  className="flex items-center gap-2.5 rounded-lg border border-ink-600/60 bg-ink-800/50 px-3 py-2"
                >
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: e.color }}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-200">{e.kind}</span>
                  <span className="shrink-0 font-mono text-[11px] tabular text-ink-400">{e.locator}</span>
                </motion.li>
              ))}
            </ul>

            <div className="mt-4 border-t border-ink-600/60 pt-4">
              <p className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">Seed channels</p>
              {[
                ["lexical", 62],
                ["text_vector", 88],
                ["visual_vector", 74],
                ["structured", 41],
              ].map(([name, pct], i) => (
                <div key={name as string} className="mb-1.5 flex items-center gap-2">
                  <span className="w-[86px] shrink-0 font-mono text-[10px] text-ink-400">{name}</span>
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-ink-700">
                    <motion.span
                      className="block h-full rounded-full"
                      style={{ backgroundColor: i === 1 ? "var(--signal)" : "rgba(25,214,196,0.42)" }}
                      initial={reduced ? { width: `${pct}%` } : { width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, delay: 1.0 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** Inline citation marker — the thing the whole product is about. */
function Cite({ n }: { n: number }) {
  return (
    // Two deliberate choices here:
    //  - align-baseline + a nudge, not align-super: `super` pushes the box
    //    outside the line box and forces uneven leading on wrapped lines.
    //  - `inline`, not `inline-flex`: an inline-flex box is an *atomic* inline,
    //    which carries a line-break opportunity before it even when no
    //    whitespace separates it from the preceding word — so the marker could
    //    wrap onto a line by itself and read as a rendering fault.
    <sup className="relative -top-[5px] ml-0.5 inline select-none rounded-[3px] border border-signal-600/40 bg-signal-900/50 px-1 py-px align-baseline font-mono text-[9px] leading-none text-signal-300">
      {n}
    </sup>
  );
}
