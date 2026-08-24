"use client";

import { motion } from "framer-motion";
import { AudioLines, FileText, Fingerprint, ImageIcon, Video } from "lucide-react";

import { MODALITY_META } from "@/lib/modality";
import { cn } from "@/lib/utils";

/**
 * Walkthrough visuals.
 *
 * Six original diagrams, one per step. Each is built from the same primitives
 * the product uses — the same modality colours, the same monospace telemetry,
 * the same locator formats — so the marketing page is a preview of the tool
 * rather than an illustration of it. None of them is a stock graphic and none
 * of them shows a number the system could not produce.
 *
 * `active` gates the entrance animation so a step animates when it is scrolled
 * to, not when the page loads.
 */

interface VisualProps {
  active: boolean;
}

const springIn = (i: number, active: boolean) => ({
  initial: { opacity: 0, y: 10 },
  animate: active ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 },
  transition: { duration: 0.45, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] as const },
});

function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grain relative h-full w-full overflow-hidden rounded-xl border border-ink-600/70 bg-ink-850/80 p-5 shadow-raised sm:p-6",
        className,
      )}
    >
      <div className="grid-field pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      {/* Centred rather than top-aligned: the visuals differ in height by a
          factor of two, and top-aligning them in a fixed-height stage left the
          shorter ones sitting under a band of empty panel. */}
      <div className="relative flex h-full flex-col justify-center">{children}</div>
    </div>
  );
}

// ── 1 · Ingest the original ────────────────────────────────────────────────

export function IngestVisual({ active }: VisualProps) {
  const checksum = "9f2c4b1ea7d38065c1b47f92ae5310d8b6c04f7391a2e58d3c9047b1f6e2a85c";
  return (
    <Frame>
      <div className="flex h-full flex-col justify-center gap-4">
        <motion.div {...springIn(0, active)} className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-modality-visual/30 bg-modality-visual/10">
            <Video className="size-5 text-modality-visual" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-ui-sm font-medium text-ink-50">architecture-review-2026-03-14.mp4</p>
            <p className="font-mono text-ui-2xs tabular text-ink-400">video/mp4 · 398.9 MB · 07:11</p>
          </div>
        </motion.div>

        <motion.div {...springIn(1, active)} className="rounded-lg border border-ink-600/70 bg-ink-900/60 p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <Fingerprint className="size-3 text-signal-400" aria-hidden />
            <span className="eyebrow">sha-256 content fingerprint</span>
          </div>
          {/* Reveals character by character — the hash is being computed, and
              the same bytes will always resolve to the same source. */}
          <p className="break-all font-mono text-[10.5px] leading-relaxed text-signal-300">
            {checksum.split("").map((char, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0 }}
                animate={active ? { opacity: 1 } : { opacity: 0 }}
                transition={{ duration: 0.01, delay: 0.35 + i * 0.008 }}
              >
                {char}
              </motion.span>
            ))}
          </p>
        </motion.div>

        <motion.div {...springIn(2, active)} className="space-y-1.5">
          {[
            ["media_type", "video", true],
            ["timeline_id", "tl_01JQZK8V3N7X2M4P6R8T0W9Y1B", true],
            ["duration_ms", "431000", true],
            ["page_count", "null — not a paged medium", false],
          ].map(([key, value, present]) => (
            <div key={key as string} className="flex items-baseline gap-2 font-mono text-[10.5px]">
              <span className="w-[86px] shrink-0 text-ink-500">{key as string}</span>
              <span className={(present as boolean) ? "text-ink-100" : "text-ink-500"}>{value as string}</span>
            </div>
          ))}
        </motion.div>

        <motion.p {...springIn(3, active)} className="text-ui-2xs leading-relaxed text-ink-400">
          Re-uploading identical bytes resolves to the same source rather than duplicating it.
        </motion.p>
      </div>
    </Frame>
  );
}

// ── 2 · Preserve atomic proof ──────────────────────────────────────────────

const ATOMIC = [
  { modality: "speech" as const, type: "utterance", locator: "01:44.2 – 02:01.9", content: "…a Redis read-through cache in front of the primary Postgres instance." },
  { modality: "video_visual" as const, type: "ocr_region", locator: "02:01.0 · bbox", content: "REDIS · read-through cache · TTL 300s" },
  { modality: "document" as const, type: "document_block", locator: "p.07 · blk_p7_b03", content: "A read-through cache introduces a staleness window bounded by the TTL." },
  { modality: "image" as const, type: "visual_state", locator: "region", content: "Hand-drawn boxes: app → redis → pg-primary." },
];

export function AtomicVisual({ active }: VisualProps) {
  return (
    <Frame>
      <div className="flex h-full flex-col justify-center gap-2">
        {ATOMIC.map((item, i) => {
          const meta = MODALITY_META[item.modality];
          return (
            // `key` goes before the spread, not after it: with the automatic
            // JSX runtime a key that follows a spread is not statically
            // hoisted, and React reports the child as having no key at all.
            <motion.div
              key={item.type}
              {...springIn(i, active)}
              className="rounded-lg border border-ink-600/70 bg-ink-900/50 p-2.5"
            >
              <div className="mb-1.5 flex items-center gap-2">
                <span aria-hidden className="size-1.5 rounded-full" style={{ background: meta.hex }} />
                <span className="font-mono text-[10.5px] uppercase tracking-[0.06em]" style={{ color: meta.hex }}>
                  {item.type}
                </span>
                <span className="ml-auto font-mono text-[10.5px] tabular text-ink-300">{item.locator}</span>
              </div>
              <p className="line-clamp-2 text-ui-2xs leading-relaxed text-ink-200">{item.content}</p>
            </motion.div>
          );
        })}
        <motion.p {...springIn(4, active)} className="pt-1 text-ui-2xs leading-relaxed text-ink-400">
          Four modalities, four locator kinds. A document block never acquires a timestamp it does not have.
        </motion.p>
      </div>
    </Frame>
  );
}

// ── 3 · Build semantic context ─────────────────────────────────────────────

export function SegmentVisual({ active }: VisualProps) {
  return (
    <Frame>
      <div className="flex h-full flex-col justify-center">
        <svg viewBox="0 0 340 250" className="w-full" role="img" aria-label="Atomic observations grouped into a retrieval-ready semantic segment while remaining individually addressable">
          {/* atomic observations */}
          {[0, 1, 2, 3].map((i) => (
            <motion.g
              key={i}
              initial={{ opacity: 0, x: -12 }}
              animate={active ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
            >
              <rect x="8" y={18 + i * 40} width="112" height="30" rx="5" fill="#0E1117" stroke="#2A3140" />
              <rect x="8" y={18 + i * 40} width="2.5" height="30" rx="1" fill="#19D6C4" />
              <rect x="20" y={27 + i * 40} width={78 - i * 9} height="3" rx="1.5" fill="#5A6577" />
              <rect x="20" y={35 + i * 40} width={58 + i * 6} height="3" rx="1.5" fill="#3D4658" />
            </motion.g>
          ))}

          {/* grouping brackets */}
          {[0, 1, 2, 3].map((i) => (
            <motion.path
              key={`l${i}`}
              d={`M124,${33 + i * 40} C152,${33 + i * 40} 152,125 178,125`}
              stroke="#19D6C4"
              strokeOpacity="0.4"
              strokeWidth="1"
              fill="none"
              initial={{ pathLength: 0 }}
              animate={active ? { pathLength: 1 } : { pathLength: 0 }}
              transition={{ duration: 0.6, delay: 0.35 + i * 0.07 }}
            />
          ))}

          {/* the semantic segment */}
          <motion.g
            initial={{ opacity: 0, scale: 0.94 }}
            animate={active ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.5, delay: 0.7 }}
            style={{ transformOrigin: "258px 125px" }}
          >
            <rect x="182" y="78" width="150" height="94" rx="8" fill="#0A5C55" fillOpacity="0.16" stroke="#19D6C4" strokeOpacity="0.5" />
            <text x="194" y="98" fill="#5EEBDC" fontSize="8.5" fontFamily="monospace" letterSpacing="0.5">
              semantic_segment
            </text>
            <rect x="194" y="108" width="126" height="3" rx="1.5" fill="#A5F5EA" fillOpacity="0.5" />
            <rect x="194" y="117" width="112" height="3" rx="1.5" fill="#A5F5EA" fillOpacity="0.35" />
            <rect x="194" y="126" width="120" height="3" rx="1.5" fill="#A5F5EA" fillOpacity="0.35" />
            <text x="194" y="152" fill="#5A6577" fontSize="7.5" fontFamily="monospace">
              member_evidence_ids: 4
            </text>
            <text x="194" y="163" fill="#5A6577" fontSize="7.5" fontFamily="monospace">
              retrieval-ready · proof intact
            </text>
          </motion.g>

          <motion.text
            x="8" y="228" fill="#5A6577" fontSize="8" fontFamily="monospace"
            initial={{ opacity: 0 }} animate={active ? { opacity: 1 } : { opacity: 0 }} transition={{ delay: 1 }}
          >
            atomic observations remain individually addressable
          </motion.text>
        </svg>
      </div>
    </Frame>
  );
}

// ── 4 · Connect evidence in time ───────────────────────────────────────────

export function TimelineVisual({ active }: VisualProps) {
  const marks = [
    { x: 40, modality: "speech", label: "01:44" },
    { x: 112, modality: "video_visual", label: "02:01" },
    { x: 176, modality: "speech", label: "02:19" },
    { x: 248, modality: "video_visual", label: "02:47" },
  ] as const;

  return (
    <Frame>
      <div className="flex h-full flex-col justify-center">
        <svg viewBox="0 0 340 250" className="w-full" role="img" aria-label="Typed directed relationships between evidence on a shared timeline, forming a semantic event">
          <text x="8" y="20" fill="#5A6577" fontSize="8" fontFamily="monospace" letterSpacing="0.6">
            TIMELINE tl_01JQZK8V · same_timeline guard active
          </text>

          {/* axis */}
          <line x1="8" y1="86" x2="332" y2="86" stroke="#2A3140" strokeWidth="1" />
          {[8, 90, 172, 254, 332].map((x) => (
            <line key={x} x1={x} y1="82" x2={x} y2="90" stroke="#2A3140" />
          ))}

          {/* time-bearing evidence */}
          {marks.map((mark, i) => (
            <motion.g
              key={i}
              initial={{ opacity: 0, y: -6 }}
              animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: 0.35, delay: i * 0.09 }}
            >
              <rect x={mark.x - 22} y="52" width="44" height="22" rx="4"
                fill={MODALITY_META[mark.modality].hex} fillOpacity="0.14"
                stroke={MODALITY_META[mark.modality].hex} strokeOpacity="0.5" />
              <text x={mark.x} y="66" textAnchor="middle" fontSize="8" fontFamily="monospace"
                fill={MODALITY_META[mark.modality].hex}>
                {mark.label}
              </text>
              <line x1={mark.x} y1="74" x2={mark.x} y2="86" stroke={MODALITY_META[mark.modality].hex} strokeOpacity="0.5" />
            </motion.g>
          ))}

          {/* typed, directed edges */}
          {[
            { d: "M40,96 C40,124 112,124 112,96", label: "TEMPORALLY_ALIGNS", x: 76, confirmed: true },
            { d: "M176,96 C176,130 248,130 248,96", label: "EXPLAINS", x: 212, confirmed: true },
          ].map((edge, i) => (
            <motion.g key={i}>
              <motion.path
                d={edge.d} fill="none" stroke="#19D6C4" strokeWidth="1.2"
                initial={{ pathLength: 0 }}
                animate={active ? { pathLength: 1 } : { pathLength: 0 }}
                transition={{ duration: 0.7, delay: 0.5 + i * 0.15 }}
              />
              <motion.text
                x={edge.x} y="142" textAnchor="middle" fontSize="7" fontFamily="monospace" fill="#5EEBDC"
                initial={{ opacity: 0 }} animate={active ? { opacity: 1 } : { opacity: 0 }}
                transition={{ delay: 0.9 + i * 0.15 }}
              >
                {edge.label}
              </motion.text>
            </motion.g>
          ))}

          {/* a document, deliberately off-timeline */}
          <motion.g
            initial={{ opacity: 0 }} animate={active ? { opacity: 1 } : { opacity: 0 }} transition={{ delay: 1.05 }}
          >
            <rect x="230" y="166" width="102" height="26" rx="4" fill="#D98E6A" fillOpacity="0.12" stroke="#D98E6A" strokeOpacity="0.45" strokeDasharray="3 3" />
            <text x="281" y="182" textAnchor="middle" fontSize="7.5" fontFamily="monospace" fill="#D98E6A">
              p.07 · no timestamp
            </text>
            <path d="M230,179 C200,179 190,120 176,96" fill="none" stroke="#7A6DC9" strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.65" />
            <text x="150" y="176" fontSize="7" fontFamily="monospace" fill="#B4A9E8">EXPLAINS</text>
          </motion.g>

          {/* the assembled event */}
          <motion.g
            initial={{ opacity: 0 }} animate={active ? { opacity: 1 } : { opacity: 0 }} transition={{ delay: 1.25 }}
          >
            <rect x="8" y="204" width="324" height="34" rx="6" fill="#0A5C55" fillOpacity="0.14" stroke="#19D6C4" strokeOpacity="0.4" />
            <text x="20" y="219" fontSize="8" fontFamily="monospace" fill="#5EEBDC">semantic_event · evt_01JQZKA1</text>
            <text x="20" y="231" fontSize="7.5" fontFamily="monospace" fill="#5A6577">
              connected components over confirmed edges · confidence 0.88
            </text>
          </motion.g>
        </svg>
      </div>
    </Frame>
  );
}

// ── 5 · Retrieve the full bundle ───────────────────────────────────────────

const CHANNELS = [
  { name: "lexical", weight: "1.0", hits: 20, color: "#C2CAD6" },
  { name: "text_vector", weight: "1.0", hits: 20, color: "#19D6C4" },
  { name: "visual_vector", weight: "2.0", hits: 14, color: "#4C9BE8" },
  { name: "structured", weight: "1.0", hits: 9, color: "#D98E6A" },
];

export function RetrievalVisual({ active }: VisualProps) {
  return (
    <Frame>
      <div className="flex h-full flex-col justify-center gap-3.5">
        <div className="space-y-1.5">
          {CHANNELS.map((channel, i) => (
            <motion.div key={channel.name} {...springIn(i, active)} className="flex items-center gap-2.5">
              <span className="w-[86px] shrink-0 font-mono text-[10.5px]" style={{ color: channel.color }}>
                {channel.name}
              </span>
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-ink-700">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: channel.color, opacity: 0.75 }}
                  initial={{ width: 0 }}
                  animate={active ? { width: `${(channel.hits / 20) * 100}%` } : { width: 0 }}
                  transition={{ duration: 0.6, delay: 0.15 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
              <span className="w-8 shrink-0 text-right font-mono text-[10.5px] tabular text-ink-400">
                ×{channel.weight}
              </span>
            </motion.div>
          ))}
        </div>

        <motion.div {...springIn(4, active)} className="flex items-center gap-2">
          <span className="h-px flex-1 bg-ink-600" />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-signal-400">
            weighted RRF · k=60
          </span>
          <span className="h-px flex-1 bg-ink-600" />
        </motion.div>

        <motion.div {...springIn(5, active)} className="grid grid-cols-3 gap-2">
          {[
            ["fused", "30", "candidates"],
            ["expanded", "+2", "hops, confirmed only"],
            ["bundle", "20", "coverage-reranked"],
          ].map(([label, value, sub]) => (
            <div key={label} className="rounded-md border border-ink-600/70 bg-ink-900/60 p-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-500">{label}</p>
              <p className="mt-0.5 font-mono text-[18px] tabular leading-none text-signal-300">{value}</p>
              <p className="mt-1 text-[10px] leading-tight text-ink-400">{sub}</p>
            </div>
          ))}
        </motion.div>

        <motion.div {...springIn(6, active)} className="rounded-md border border-ink-600/70 bg-ink-900/50 p-2.5">
          <p className="eyebrow mb-1.5">answer slots covered</p>
          <div className="flex flex-wrap gap-1.5">
            {["who → speech", "where_shown → video_visual", "architecture → document"].map((slot) => (
              <span key={slot} className="rounded-sm border border-signal-600/40 bg-signal-900/40 px-1.5 py-px font-mono text-[10px] text-signal-300">
                {slot}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </Frame>
  );
}

// ── 6 · Answer with provenance ─────────────────────────────────────────────

export function AnswerVisual({ active }: VisualProps) {
  return (
    <Frame>
      <div className="flex h-full flex-col justify-center gap-3">
        <motion.div {...springIn(0, active)} className="rounded-lg border border-ink-600/70 bg-ink-900/60 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-[10px] tabular text-ink-500">01</span>
            <span className="rounded-full border border-validated-500/40 bg-validated-900/60 px-1.5 py-px text-[10px] text-validated-400">
              High
            </span>
          </div>
          <p className="text-ui-xs leading-relaxed text-ink-50">
            The architecture is a Redis read-through cache in front of the Postgres primary.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-ink-500">Cites</span>
            {[
              { locator: "01:44.2", color: MODALITY_META.speech.hex },
              { locator: "02:01.0", color: MODALITY_META.video_visual.hex },
              { locator: "p.07", color: MODALITY_META.document.hex },
            ].map((chip, i) => (
              <motion.span
                key={chip.locator}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={active ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3, delay: 0.35 + i * 0.09 }}
                className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-[10px] tabular"
                style={{ borderColor: `${chip.color}59`, background: `${chip.color}1a`, color: chip.color }}
              >
                <span className="size-1 rounded-full" style={{ background: chip.color }} />
                {chip.locator}
              </motion.span>
            ))}
          </div>
        </motion.div>

        {/* the lineage that a citation resolves through */}
        <motion.div {...springIn(1, active)} className="rounded-lg border border-signal-600/30 bg-signal-900/20 p-3">
          <p className="eyebrow mb-2">open at source</p>
          <ol className="space-y-1.5">
            {[
              ["evidence", "ev_01JQZKB1…K9M0"],
              ["asset", "frame @ 02:01.0"],
              ["source", "architecture-review.mp4"],
              ["checksum", "9f2c4b1e…2a85c"],
            ].map(([label, value], i) => (
              <motion.li
                key={label}
                initial={{ opacity: 0, x: -6 }}
                animate={active ? { opacity: 1, x: 0 } : { opacity: 0, x: -6 }}
                transition={{ duration: 0.3, delay: 0.6 + i * 0.08 }}
                className="flex items-center gap-2 font-mono text-[10.5px]"
              >
                <span className="text-signal-600">{i === 3 ? "└" : "├"}</span>
                <span className="w-[62px] text-ink-500">{label}</span>
                <span className="truncate text-ink-100">{value}</span>
              </motion.li>
            ))}
          </ol>
        </motion.div>

        <motion.div {...springIn(2, active)} className="rounded-lg border border-caution-500/25 bg-caution-900/25 p-2.5">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-caution-400">missing information</p>
          <p className="text-[10.5px] leading-relaxed text-ink-300">
            No evidence in this collection states who approved the proposal.
          </p>
        </motion.div>
      </div>
    </Frame>
  );
}

export const STEP_ICONS = { Video, AudioLines, ImageIcon, FileText, Fingerprint };
