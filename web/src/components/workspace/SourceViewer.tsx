"use client";

import { FileWarning, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { assetUrl, IS_DEMO_MODE } from "@/lib/api";
import type { EvidenceItem, Source } from "@/lib/api/schemas";
import { formatTimecode } from "@/lib/format";
import { cn } from "@/lib/utils";

import { locatorKind } from "@/components/ui/SourceLocator";

/**
 * Renders a source at the locator stored on a piece of evidence.
 *
 * Every position here comes from the API record — `start_ms` seeks the player,
 * `page` selects the page, `bbox_norm` places the overlay. Nothing is
 * estimated. If the locator has no usable coordinates the viewer says so
 * instead of showing the top of the file and implying that is the spot.
 *
 * In demo mode there are no real bytes behind `storage_path`, so the media
 * elements are replaced by a schematic that still honours the locator — an
 * accurate diagram beats a broken <video> element.
 */
export function SourceViewer({ source, evidence }: { source: Source; evidence: EvidenceItem }) {
  const kind = locatorKind(evidence.location);

  if (kind === "none") {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-caution-500/30 bg-caution-900/25 px-4 py-8 text-center">
        <FileWarning className="size-5 text-caution-500" aria-hidden />
        <p className="text-ui-sm font-medium text-ink-50">No locator stored</p>
        <p className="max-w-xs text-pretty text-ui-2xs leading-relaxed text-ink-300">
          This evidence item has no timestamp, page or region recorded, so there is no position in the source to open
          it at.
        </p>
      </div>
    );
  }

  if (source.media_type === "video" || source.media_type === "audio") {
    return <TimeBasedViewer source={source} evidence={evidence} />;
  }
  return <SpatialViewer source={source} evidence={evidence} />;
}

// ── time-based: video and audio ────────────────────────────────────────────

function TimeBasedViewer({ source, evidence }: { source: Source; evidence: EvidenceItem }) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(evidence.location.start_ms ?? 0);
  const [mediaError, setMediaError] = useState(false);

  const startMs = evidence.location.start_ms ?? 0;
  const endMs = evidence.location.end_ms ?? startMs;
  const durationMs = source.duration_ms ?? Math.max(endMs, startMs) + 1;
  const isVideo = source.media_type === "video";

  // Seek to the stored start the moment the element can accept a seek.
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    const onLoaded = () => {
      el.currentTime = startMs / 1000;
      setCurrentMs(startMs);
    };
    el.addEventListener("loadedmetadata", onLoaded);
    if (el.readyState >= 1) onLoaded();
    return () => el.removeEventListener("loadedmetadata", onLoaded);
  }, [startMs]);

  const toggle = () => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) {
      // Re-seek if playback drifted outside the cited span.
      if (el.currentTime * 1000 < startMs - 250 || el.currentTime * 1000 > endMs + 2000) {
        el.currentTime = startMs / 1000;
      }
      void el.play();
    } else {
      el.pause();
    }
  };

  const unavailable = IS_DEMO_MODE || mediaError;

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-lg border border-ink-600 bg-ink-950">
        {unavailable ? (
          <SchematicFrame
            label={isVideo ? "video frame" : "audio waveform"}
            bbox={evidence.location.bbox_norm}
            caption={
              IS_DEMO_MODE
                ? "Demo mode — no media bytes are served. The locator below is the real stored value."
                : "The source file could not be loaded from the asset store."
            }
            audio={!isVideo}
          />
        ) : isVideo ? (
          <video
            ref={mediaRef as React.RefObject<HTMLVideoElement>}
            src={assetUrl(source.storage_path)}
            controls
            preload="metadata"
            onError={() => setMediaError(true)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
            className="aspect-video w-full bg-black"
          >
            <track kind="captions" />
          </video>
        ) : (
          <div className="p-4">
            <audio
              ref={mediaRef as React.RefObject<HTMLAudioElement>}
              src={assetUrl(source.storage_path)}
              controls
              preload="metadata"
              onError={() => setMediaError(true)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
              className="w-full"
            />
          </div>
        )}

        {/* Bounding box overlay for OCR regions on video frames. */}
        {isVideo && evidence.location.bbox_norm && !unavailable && (
          <BBoxOverlay bbox={evidence.location.bbox_norm} />
        )}
      </div>

      {/* Cited span, drawn to scale against the whole source. */}
      <div className="rounded-lg border border-ink-600 bg-ink-850/70 p-2.5">
        <div className="mb-2 flex items-center gap-2">
          {!unavailable && (
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? "Pause" : `Play from ${formatTimecode(startMs)}`}
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-signal-500 text-ink-950 transition-colors hover:bg-signal-400"
            >
              {playing ? <Pause className="size-3 fill-current" aria-hidden /> : <Play className="size-3 fill-current" aria-hidden />}
            </button>
          )}
          <span className="font-mono text-ui-2xs tabular text-signal-400">{formatTimecode(currentMs)}</span>
          <span className="ml-auto font-mono text-ui-2xs tabular text-ink-400">{formatTimecode(durationMs)}</span>
        </div>

        <div className="relative h-1.5 overflow-hidden rounded-full bg-ink-700">
          {/* the cited span */}
          <div
            className="absolute inset-y-0 rounded-full bg-signal-500/40"
            style={{
              left: `${(startMs / durationMs) * 100}%`,
              width: `${Math.max(0.8, ((endMs - startMs) / durationMs) * 100)}%`,
            }}
            title={`Cited span ${formatTimecode(startMs)} – ${formatTimecode(endMs)}`}
          />
          {/* playhead */}
          <div
            className="absolute inset-y-0 w-0.5 bg-signal-300"
            style={{ left: `${Math.min(100, (currentMs / durationMs) * 100)}%` }}
          />
        </div>

        <p className="mt-1.5 font-mono text-[10px] tabular text-ink-400">
          cited span {formatTimecode(startMs)} – {formatTimecode(endMs)}
        </p>
      </div>
    </div>
  );
}

// ── spatial: documents and images ──────────────────────────────────────────

function SpatialViewer({ source, evidence }: { source: Source; evidence: EvidenceItem }) {
  const [imageError, setImageError] = useState(false);
  const page = evidence.location.page;
  const bbox = evidence.location.bbox_norm;
  const unavailable = IS_DEMO_MODE || imageError;

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-lg border border-ink-600 bg-ink-950">
        {unavailable ? (
          <SchematicFrame
            label={source.media_type === "document" ? `page ${page ?? "—"}` : "image"}
            bbox={bbox}
            document={source.media_type === "document"}
            caption={
              IS_DEMO_MODE
                ? "Demo mode — no media bytes are served. The region below is the real stored bounding box."
                : "The source file could not be loaded from the asset store."
            }
          />
        ) : (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={assetUrl(source.storage_path)}
              alt={`${source.filename}${page ? `, page ${page}` : ""}`}
              onError={() => setImageError(true)}
              className="w-full"
            />
            {bbox && <BBoxOverlay bbox={bbox} />}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-850/70 px-2.5 py-2">
        {page !== null && page !== undefined && (
          <span className="font-mono text-ui-2xs tabular text-ink-100">
            page {page}
            {source.page_count ? <span className="text-ink-400"> of {source.page_count}</span> : null}
          </span>
        )}
        {bbox && (
          <span className="ml-auto font-mono text-[10px] tabular text-ink-400">
            [{bbox.x1.toFixed(3)}, {bbox.y1.toFixed(3)}] → [{bbox.x2.toFixed(3)}, {bbox.y2.toFixed(3)}]
          </span>
        )}
      </div>
    </div>
  );
}

/** Normalised box drawn over whatever media is beneath it. */
function BBoxOverlay({ bbox }: { bbox: { x1: number; y1: number; x2: number; y2: number } }) {
  return (
    <div
      className="pointer-events-none absolute border-2 border-signal-500 bg-signal-500/10"
      style={{
        left: `${bbox.x1 * 100}%`,
        top: `${bbox.y1 * 100}%`,
        width: `${(bbox.x2 - bbox.x1) * 100}%`,
        height: `${(bbox.y2 - bbox.y1) * 100}%`,
      }}
      aria-hidden
    >
      {/* corner ticks */}
      {(["-top-px -left-px", "-top-px -right-px", "-bottom-px -left-px", "-bottom-px -right-px"] as const).map((pos) => (
        <span key={pos} className={cn("absolute size-2 border-signal-300", pos)} />
      ))}
    </div>
  );
}

/**
 * Stand-in for media that cannot be fetched. It is explicitly a schematic —
 * labelled as such — and it still draws the real bounding box at the real
 * normalised coordinates, so the locator is verifiable even here.
 */
function SchematicFrame({
  label,
  bbox,
  caption,
  document: isDocument,
  audio,
}: {
  label: string;
  bbox?: { x1: number; y1: number; x2: number; y2: number } | null;
  caption: string;
  document?: boolean;
  audio?: boolean;
}) {
  return (
    <div>
      <div className={cn("relative bg-ink-900", isDocument ? "aspect-[3/4]" : "aspect-video")}>
        <div className="grid-field absolute inset-0 opacity-60" aria-hidden />

        {audio ? (
          <div className="absolute inset-0 flex items-center justify-center gap-[3px] px-8" aria-hidden>
            {Array.from({ length: 64 }).map((_, i) => {
              const u = i / 63;
              const burst =
                Math.exp(-Math.pow((u - 0.3) / 0.2, 2)) + Math.exp(-Math.pow((u - 0.74) / 0.16, 2)) * 0.8;
              const h = Math.max(3, burst * (0.6 + 0.4 * Math.abs(Math.sin(u * Math.PI * 14))) * 70);
              return <span key={i} className="w-[2px] rounded-full bg-signal-500/50" style={{ height: `${h}%` }} />;
            })}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-mono text-ui-2xs uppercase tracking-[0.14em] text-ink-500">{label}</span>
          </div>
        )}

        {bbox && <BBoxOverlay bbox={bbox} />}
      </div>
      <p className="border-t border-ink-600 bg-ink-850 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-ink-400">
        {caption}
      </p>
    </div>
  );
}
