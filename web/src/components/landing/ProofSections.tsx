"use client";

import { motion, useInView } from "framer-motion";
import { ArrowRight, Quote } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { Button } from "@/components/ui/Button";
import { MODALITY_META } from "@/lib/modality";
import { cn } from "@/lib/utils";

/**
 * Three proof sections — the arguments the product actually rests on, each
 * shown as a comparison or a mechanism rather than asserted as a benefit.
 */

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return { ref, inView };
}

function SectionHeader({ eyebrow, title, lede }: { eyebrow: string; title: string; lede: string }) {
  return (
    <header className="mb-12 max-w-2xl">
      <p className="eyebrow mb-4">{eyebrow}</p>
      <h2 className="text-balance font-display text-display-md text-ink-50">{title}</h2>
      <p className="mt-4 text-pretty text-ui-lg leading-relaxed text-ink-300">{lede}</p>
    </header>
  );
}

// ── 1 · Atomic proof is not a text chunk ───────────────────────────────────

export function AtomicProofSection() {
  const { ref, inView } = useReveal();

  return (
    <section id="system" className="border-t border-ink-800 bg-ink-950 py-24 sm:py-28">
      <div ref={ref} className="mx-auto max-w-6xl px-6 sm:px-8">
        <SectionHeader
          eyebrow="Representation"
          title="Atomic proof is not a text chunk."
          lede="Most pipelines flatten every modality into one pile of text and lose the thing that made it evidence. OmniTrace keeps two objects with two different lifetimes."
        />

        <div className="grid gap-4 md:grid-cols-2">
          <motion.article
            initial={{ opacity: 0, y: 16 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5 }}
            className="rounded-xl border border-ink-600/70 bg-ink-850/60 p-5"
          >
            <div className="mb-4 flex items-center gap-2">
              <span aria-hidden className="size-2 rounded-full" style={{ background: MODALITY_META.speech.hex }} />
              <h3 className="text-ui-sm font-medium text-ink-50">Atomic observation</h3>
              <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.1em] text-ink-500">immutable</span>
            </div>

            <blockquote className="rounded-md border-l-2 border-signal-600/50 bg-ink-900/70 py-2.5 pl-3 pr-2.5">
              <Quote className="mb-1.5 size-3 text-ink-500" aria-hidden />
              <p className="text-ui-xs leading-relaxed text-ink-100">
                &ldquo;So the proposal is a Redis read-through cache in front of the primary Postgres instance.&rdquo;
              </p>
            </blockquote>

            <dl className="mt-4 space-y-1">
              {[
                ["evidence_type", "utterance"],
                ["location", "01:44.2 → 02:01.9"],
                ["timeline_id", "tl_01JQZK8V…9Y1B"],
                ["speaker_id", "spk_02"],
                ["extraction", "0.94"],
                ["producer", "pipeline.audio · whisper-large-v3"],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2 font-mono text-[10.5px]">
                  <dt className="w-[88px] shrink-0 text-ink-500">{k}</dt>
                  <dd className="min-w-0 flex-1 truncate text-ink-200">{v}</dd>
                </div>
              ))}
            </dl>

            <p className="mt-4 border-t border-ink-700/60 pt-3 text-ui-2xs leading-relaxed text-ink-400">
              This is the thing you can open, play back and check. It is never rewritten, merged or summarised — later
              stages only ever point at it.
            </p>
          </motion.article>

          <motion.article
            initial={{ opacity: 0, y: 16 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="rounded-xl border border-uv-500/25 bg-uv-800/10 p-5"
          >
            <div className="mb-4 flex items-center gap-2">
              <span aria-hidden className="size-2 rounded-full bg-uv-400" />
              <h3 className="text-ui-sm font-medium text-ink-50">Semantic segment</h3>
              <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.1em] text-ink-500">derived</span>
            </div>

            <blockquote className="rounded-md border-l-2 border-uv-500/50 bg-ink-900/70 py-2.5 pl-3 pr-2.5">
              <Quote className="mb-1.5 size-3 text-ink-500" aria-hidden />
              <p className="text-ui-xs leading-relaxed text-ink-100">
                Discussion of the read-through cache proposal: the topology, the measured reduction in primary read
                load, and the objection that permissions data cannot tolerate TTL-based staleness.
              </p>
            </blockquote>

            <dl className="mt-4 space-y-1">
              {[
                ["node_type", "semantic_segment"],
                ["location", "01:44.2 → 03:08.6"],
                ["member_ids", "4 atomic observations"],
                ["embedding", "text · voyage-3"],
                ["purpose", "retrieval, not proof"],
                ["producer", "enrich.segment · v1"],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2 font-mono text-[10.5px]">
                  <dt className="w-[88px] shrink-0 text-ink-500">{k}</dt>
                  <dd className="min-w-0 flex-1 truncate text-ink-200">{v}</dd>
                </div>
              ))}
            </dl>

            <p className="mt-4 border-t border-ink-700/60 pt-3 text-ui-2xs leading-relaxed text-ink-400">
              Sized for meaning so a vector search can find it. It cites its members rather than replacing them, so
              finding the segment always yields the underlying proof.
            </p>
          </motion.article>
        </div>
      </div>
    </section>
  );
}

// ── 2 · Connected context, not coincidence ─────────────────────────────────

export function ConnectedContextSection() {
  const { ref, inView } = useReveal();

  return (
    <section className="border-t border-ink-800 bg-ink-900 py-24 sm:py-28">
      <div ref={ref} className="mx-auto max-w-6xl px-6 sm:px-8">
        <SectionHeader
          eyebrow="Relationships"
          title="Connected context, not coincidence."
          lede="Two things happening at 00:30 in two unrelated recordings is not a relationship. Every link carries a type, a direction, a score, and the timeline it was allowed to form on."
        />

        <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5 }}
            className="grain relative overflow-hidden rounded-xl border border-ink-600/70 bg-ink-850/60 p-5"
          >
            <div className="grid-field pointer-events-none absolute inset-0 opacity-40" aria-hidden />
            <div className="relative">
              <p className="eyebrow mb-4">Timeline-constrained linking</p>
              <svg viewBox="0 0 480 210" className="w-full" role="img" aria-label="Two separate timelines; a link forms within one and is rejected across the other">
                {/* timeline A */}
                <text x="0" y="14" fontSize="8.5" fontFamily="monospace" fill="#5A6577">tl_01JQZK8V · architecture-review.mp4</text>
                <line x1="0" y1="34" x2="480" y2="34" stroke="#2A3140" />
                <rect x="66" y="22" width="52" height="24" rx="4" fill="#19D6C4" fillOpacity="0.15" stroke="#19D6C4" strokeOpacity="0.5" />
                <text x="92" y="38" textAnchor="middle" fontSize="8" fontFamily="monospace" fill="#19D6C4">01:44</text>
                <rect x="176" y="22" width="52" height="24" rx="4" fill="#4C9BE8" fillOpacity="0.15" stroke="#4C9BE8" strokeOpacity="0.5" />
                <text x="202" y="38" textAnchor="middle" fontSize="8" fontFamily="monospace" fill="#4C9BE8">02:01</text>

                {/* accepted link */}
                <motion.path
                  d="M92,52 C92,84 202,84 202,52" fill="none" stroke="#19D6C4" strokeWidth="1.3"
                  initial={{ pathLength: 0 }} animate={inView ? { pathLength: 1 } : {}} transition={{ duration: 0.8, delay: 0.3 }}
                />
                <text x="147" y="98" textAnchor="middle" fontSize="7.5" fontFamily="monospace" fill="#5EEBDC">
                  TEMPORALLY_ALIGNS · 0.93 · confirmed
                </text>

                {/* timeline B */}
                <text x="0" y="140" fontSize="8.5" fontFamily="monospace" fill="#5A6577">tl_01JQZK9M · followup-standup.m4a</text>
                <line x1="0" y1="160" x2="480" y2="160" stroke="#2A3140" />
                <rect x="176" y="148" width="52" height="24" rx="4" fill="#19D6C4" fillOpacity="0.1" stroke="#19D6C4" strokeOpacity="0.3" />
                <text x="202" y="164" textAnchor="middle" fontSize="8" fontFamily="monospace" fill="#8B96A8">02:01</text>

                {/* rejected link */}
                <motion.path
                  d="M202,52 L202,148" fill="none" stroke="#D64545" strokeWidth="1.1" strokeDasharray="4 4"
                  initial={{ opacity: 0 }} animate={inView ? { opacity: 0.8 } : {}} transition={{ duration: 0.4, delay: 1.1 }}
                />
                <motion.g initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}} transition={{ delay: 1.3 }}>
                  <line x1="194" y1="92" x2="210" y2="108" stroke="#D64545" strokeWidth="1.6" />
                  <line x1="210" y1="92" x2="194" y2="108" stroke="#D64545" strokeWidth="1.6" />
                  <text x="222" y="104" fontSize="7.5" fontFamily="monospace" fill="#E87070">
                    rejected · same_timeline = false
                  </text>
                </motion.g>
              </svg>
              <p className="mt-4 border-t border-ink-700/60 pt-3 text-ui-2xs leading-relaxed text-ink-400">
                The timeline guard is what separates a temporal model from a coincidence engine. Cross-source links are
                still possible — they just have to be earned by entity and semantic signal, not by clock position.
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="rounded-xl border border-ink-600/70 bg-ink-850/60 p-5"
          >
            <p className="eyebrow mb-4">Assembled semantic event</p>
            <h3 className="text-ui-lg font-medium leading-snug text-ink-50">
              Read-through cache proposal and its staleness objection
            </h3>
            <p className="mt-2.5 text-pretty text-ui-xs leading-relaxed text-ink-300">
              A Redis read-through cache is proposed in front of the Postgres primary, presented with a topology slide
              and a measured load-reduction table, and challenged on permissions staleness.
            </p>

            <dl className="mt-5 space-y-2.5 border-t border-ink-700/60 pt-4">
              {[
                ["Sources", "4 · video, document, image, audio"],
                ["Members", "9 evidence items"],
                ["Span", "01:44.2 → 03:08.6"],
                ["Clustering", "connected components over confirmed edges"],
                ["Confidence", "0.88"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-3">
                  <dt className="w-[86px] shrink-0 text-ui-2xs text-ink-400">{k}</dt>
                  <dd className="flex-1 font-mono text-[10.5px] text-ink-100">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-5 flex flex-wrap gap-1.5">
              {(["speech", "video_visual", "image", "document"] as const).map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-[10px]"
                  style={{
                    borderColor: `${MODALITY_META[m].hex}59`,
                    background: `${MODALITY_META[m].hex}14`,
                    color: MODALITY_META[m].hex,
                  }}
                >
                  <span className="size-1 rounded-full" style={{ background: MODALITY_META[m].hex }} />
                  {MODALITY_META[m].short}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ── 3 · Evidence-only answers ──────────────────────────────────────────────

export function EvidenceOnlySection() {
  const { ref, inView } = useReveal();

  return (
    <section id="provenance" className="border-t border-ink-800 bg-ink-950 py-24 sm:py-28">
      <div ref={ref} className="mx-auto max-w-6xl px-6 sm:px-8">
        <SectionHeader
          eyebrow="Generation"
          title="Evidence-only answers."
          lede="The model is given the retrieved bundle and nothing else. It may cite only IDs inside that bundle, and it is never allowed to state a timestamp or a page in its own words — those are attached afterwards from the stored record."
        />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="overflow-hidden rounded-xl border border-ink-600/70 bg-ink-850/60"
        >
          <div className="flex items-center gap-2 border-b border-ink-600/60 px-5 py-3">
            <span className="eyebrow">Claim</span>
            <span className="ml-auto rounded-full border border-validated-500/40 bg-validated-900/60 px-2 py-0.5 text-[10px] text-validated-400">
              High support
            </span>
          </div>

          <div className="grid lg:grid-cols-[1.1fr_1fr]">
            <div className="border-b border-ink-600/50 p-5 lg:border-b-0 lg:border-r">
              <p className="text-pretty text-ui-lg leading-relaxed text-ink-50">
                It was shown on screen as a three-tier topology diagram with a read-through cache layer.
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-1.5">
                <span className="text-ui-2xs text-ink-400">Cites</span>
                {[
                  { locator: "02:01.0 – 02:47.5", modality: "video_visual" as const },
                  { locator: "02:01.0 · region", modality: "video_visual" as const },
                ].map((chip, i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={inView ? { opacity: 1, scale: 1 } : {}}
                    transition={{ duration: 0.3, delay: 0.35 + i * 0.1 }}
                    className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[10.5px] tabular"
                    style={{
                      borderColor: `${MODALITY_META[chip.modality].hex}59`,
                      background: `${MODALITY_META[chip.modality].hex}14`,
                      color: MODALITY_META[chip.modality].hex,
                    }}
                  >
                    <span className="size-1.5 rounded-full" style={{ background: MODALITY_META[chip.modality].hex }} />
                    {chip.locator}
                  </motion.span>
                ))}
              </div>

              <p className="mt-5 text-ui-2xs leading-relaxed text-ink-400">
                Each chip is a live control. Opening one resolves the evidence to its parent asset and seeks the player
                to the exact millisecond — or opens the page and draws the stored bounding box.
              </p>
            </div>

            {/* the resolved source */}
            <div className="grain relative bg-ink-900/70 p-5">
              <p className="eyebrow mb-3">Resolved source</p>
              <div className="relative overflow-hidden rounded-md border border-ink-600">
                {/* a schematic frame with the stored bbox drawn on it */}
                <svg viewBox="0 0 320 180" className="w-full bg-ink-950">
                  <rect width="320" height="180" fill="#0D131B" />
                  <g stroke="#3D4658" strokeWidth="1.2" fill="none">
                    <rect x="42" y="70" width="52" height="32" />
                    <rect x="134" y="70" width="52" height="32" />
                    <rect x="226" y="70" width="52" height="32" />
                    <path d="M94,86 L134,86 M186,86 L226,86" />
                  </g>
                  <motion.g
                    initial={{ opacity: 0 }}
                    animate={inView ? { opacity: 1 } : {}}
                    transition={{ duration: 0.4, delay: 0.7 }}
                  >
                    <rect x="130" y="66" width="60" height="40" fill="#19D6C4" fillOpacity="0.12" stroke="#19D6C4" strokeWidth="1.5" />
                    {[
                      [130, 66, 10, 0], [130, 66, 0, 10],
                      [190, 66, -10, 0], [190, 66, 0, 10],
                      [130, 106, 10, 0], [130, 106, 0, -10],
                      [190, 106, -10, 0], [190, 106, 0, -10],
                    ].map(([x, y, dx, dy], i) => (
                      <line key={i} x1={x} y1={y} x2={x + dx} y2={y + dy} stroke="#19D6C4" strokeWidth="2" />
                    ))}
                  </motion.g>
                  <rect y="0" width="320" height="10" fill="#06070A" />
                  <rect y="170" width="320" height="10" fill="#06070A" />
                </svg>
                {/* transport bar */}
                <div className="flex items-center gap-2 border-t border-ink-600 bg-ink-850 px-2.5 py-1.5">
                  <span className="font-mono text-[10px] tabular text-signal-400">02:01.0</span>
                  <div className="relative h-0.5 flex-1 rounded-full bg-ink-600">
                    <motion.div
                      className="absolute inset-y-0 left-0 rounded-full bg-signal-500"
                      initial={{ width: 0 }}
                      animate={inView ? { width: "28%" } : {}}
                      transition={{ duration: 0.8, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                  <span className="font-mono text-[10px] tabular text-ink-400">07:11</span>
                </div>
              </div>

              <dl className="mt-4 space-y-1">
                {[
                  ["bbox_norm", "[0.312, 0.404] → [0.688, 0.521]"],
                  ["asset", "frame · derived from raw"],
                  ["sha256", "9f2c4b1e…6e2a85c"],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-2 font-mono text-[10px]">
                    <dt className="w-[64px] shrink-0 text-ink-500">{k}</dt>
                    <dd className="min-w-0 flex-1 truncate text-ink-200">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ── closing ────────────────────────────────────────────────────────────────

export function ClosingCTA() {
  return (
    <section className="grain relative overflow-hidden border-t border-ink-800 bg-ink-900 py-28 sm:py-36">
      <div className="grid-field absolute inset-0 opacity-60" aria-hidden />
      <div
        className="absolute inset-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(58% 60% at 50% 42%, rgba(25,214,196,0.11), transparent 66%), radial-gradient(42% 46% at 78% 78%, rgba(122,109,201,0.09), transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-3xl px-6 text-center sm:px-8">
        <h2 className="text-balance font-display text-display-lg text-ink-50">From raw media to defensible answers.</h2>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-ui-lg leading-relaxed text-ink-300">
          Ingest a source, ask a question, and open every claim at the frame, page or region it came from.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" variant="marketing">
            <Link href="/workspace">
              Open workspace
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            {/* Not the evidence graph: it is drawn from one conversation's
                bundle, so arriving there straight from the marketing page
                lands on an empty canvas. */}
            <a href="#workflow">See how it works</a>
          </Button>
        </div>
      </div>
    </section>
  );
}
