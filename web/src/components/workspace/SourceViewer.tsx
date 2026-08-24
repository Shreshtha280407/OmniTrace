"use client";

import { ChevronLeft, ChevronRight, Expand, Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { assetUrl, documentPageUrl, IS_DEMO_MODE } from "@/lib/api";
import type { EvidenceItem, Source } from "@/lib/api/schemas";
import { formatTimecode } from "@/lib/format";
import { cn } from "@/lib/utils";


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
export function SourceViewer({ source, evidence }: { source: Source; evidence?: EvidenceItem }) {
  // No evidence means "just open this file" — the files menu opens a whole
  // source with no particular position in it, so there is no locator to honour
  // and nothing to warn about.
  if (!evidence) {
    if (source.media_type === "video" || source.media_type === "audio") {
      return <TimeBasedViewer source={source} />;
    }
    return <SpatialViewer source={source} />;
  }

  // A missing locator is a missing *highlight*, not a missing file. This used
  // to replace the whole viewer with a warning, so an image whose evidence
  // carried no bounding box could not be looked at at all — the one thing the
  // panel exists to do. The viewers below already treat every locator field as
  // optional: no bbox draws no overlay, no page opens at the first, no
  // start_ms opens at zero. The absence is reported in the caption instead.
  if (source.media_type === "video" || source.media_type === "audio") {
    return <TimeBasedViewer source={source} evidence={evidence} />;
  }
  return <SpatialViewer source={source} evidence={evidence} />;
}

// ── time-based: video and audio ────────────────────────────────────────────

function TimeBasedViewer({ source, evidence }: { source: Source; evidence?: EvidenceItem }) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(evidence?.location.start_ms ?? 0);
  const [mediaError, setMediaError] = useState(false);

  const startMs = evidence?.location.start_ms ?? 0;
  const endMs = evidence?.location.end_ms ?? startMs;
  const durationMs = source.duration_ms ?? Math.max(endMs, startMs) + 1;
  const isVideo = source.media_type === "video";

  // Playback is confined to the cited span when there is one. A citation that
  // says 01:44.2–02:01.9 means those seventeen seconds; letting it run on into
  // the rest of the recording makes the viewer show material the claim never
  // rested on. Opened from the files menu there is no citation and the whole
  // recording plays.
  const clipped = Boolean(evidence && evidence.location.start_ms !== null && evidence.location.start_ms !== undefined);
  const clipEndMs = endMs > startMs ? endMs : durationMs;

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
      // Re-seek if playback drifted outside the cited span — including the
      // case where it has just been stopped at the span's end.
      const ms = el.currentTime * 1000;
      if (clipped && (ms < startMs - 250 || ms >= clipEndMs - 50)) {
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
            bbox={evidence?.location.bbox_norm}
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
            onTimeUpdate={(e) => {
              const ms = e.currentTarget.currentTime * 1000;
              setCurrentMs(ms);
              if (clipped && ms >= clipEndMs) {
                e.currentTarget.pause();
                e.currentTarget.currentTime = clipEndMs / 1000;
              }
            }}
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
              onTimeUpdate={(e) => {
                const ms = e.currentTarget.currentTime * 1000;
                setCurrentMs(ms);
                if (clipped && ms >= clipEndMs) {
                  e.currentTarget.pause();
                  e.currentTarget.currentTime = clipEndMs / 1000;
                }
              }}
              className="w-full"
            />
          </div>
        )}

        {/* Bounding box overlay for OCR regions on video frames. */}
        {isVideo && evidence?.location.bbox_norm && !unavailable && (
          <BBoxOverlay bbox={evidence?.location.bbox_norm} />
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

function SpatialViewer({ source, evidence }: { source: Source; evidence?: EvidenceItem }) {
  const [imageError, setImageError] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const isDocument = source.media_type === "document";
  const pageCount = source.page_count ?? 1;

  // A cited document opens at its page and stays there — that page *is* the
  // citation. Opened from the files menu there is no citation, so the whole
  // document is browsable from the first page.
  const citedPage = evidence?.location.page ?? null;
  const [browsePage, setBrowsePage] = useState(citedPage ?? 1);
  const page = isDocument ? (citedPage ?? browsePage) : evidence?.location.page;

  const bbox = evidence?.location.bbox_norm;
  const unavailable = IS_DEMO_MODE || imageError;

  // Documents are served a page at a time; images are served whole.
  const src = isDocument ? documentPageUrl(source._id, page ?? 1) : assetUrl(source.storage_path);
  const browsable = isDocument && citedPage === null && pageCount > 1;

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
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="group relative block w-full cursor-zoom-in"
            aria-label={`View ${source.filename} full screen`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`${source.filename}${page ? `, page ${page}` : ""}`}
              onError={() => setImageError(true)}
              className="w-full"
            />
            {bbox && <BBoxOverlay bbox={bbox} />}
            <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-ink-950/75 px-1.5 py-1 font-mono text-[10px] text-ink-100 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
              <Expand className="size-3" aria-hidden />
              expand
            </span>
          </button>
        )}
      </div>

      {fullscreen && !unavailable && (
        <Lightbox
          src={src}
          alt={source.filename}
          bbox={bbox}
          onClose={() => setFullscreen(false)}
        />
      )}

      <div className="flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-850/70 px-2.5 py-2">
        {browsable && (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setBrowsePage((n) => Math.max(1, n - 1))}
              disabled={browsePage <= 1}
              className="inline-flex size-6 items-center justify-center rounded-sm border border-ink-600 text-ink-200 transition-colors hover:bg-ink-700 disabled:opacity-40 disabled:hover:bg-transparent"
              aria-label="Previous page"
            >
              <ChevronLeft className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setBrowsePage((n) => Math.min(pageCount, n + 1))}
              disabled={browsePage >= pageCount}
              className="inline-flex size-6 items-center justify-center rounded-sm border border-ink-600 text-ink-200 transition-colors hover:bg-ink-700 disabled:opacity-40 disabled:hover:bg-transparent"
              aria-label="Next page"
            >
              <ChevronRight className="size-3.5" aria-hidden />
            </button>
          </span>
        )}
        {page !== null && page !== undefined && (
          <span className="font-mono text-ui-2xs tabular text-ink-100">
            page {page}
            {source.page_count ? <span className="text-ink-400"> of {source.page_count}</span> : null}
            {citedPage !== null && <span className="text-signal-400"> · cited</span>}
          </span>
        )}
        {bbox ? (
          <span className="ml-auto font-mono text-[10px] tabular text-ink-400">
            [{bbox.x1.toFixed(3)}, {bbox.y1.toFixed(3)}] → [{bbox.x2.toFixed(3)}, {bbox.y2.toFixed(3)}]
          </span>
        ) : (
          <span className="ml-auto font-mono text-[10px] text-ink-400">no stored region · whole file</span>
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

/**
 * Full-viewport view of a still image.
 *
 * The drawer is a ~672px column, which is not enough to read a diagram or a
 * scanned page. The bounding box is drawn here too — the point of enlarging
 * the image is usually to look at the region that was cited, so dropping the
 * highlight at the exact moment it becomes legible would be backwards.
 */
function Lightbox({
  src,
  alt,
  bbox,
  onClose,
}: {
  src: string;
  alt: string;
  bbox?: { x1: number; y1: number; x2: number; y2: number } | null;
  onClose: () => void;
}) {
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // stopImmediatePropagation, not stopPropagation: Radix's dismissable
        // layer listens on the document too, and stopPropagation only stops
        // the event reaching *other nodes* — listeners already bound to this
        // same node still fire. Without this, one Escape closed the lightbox
        // and the drawer behind it in a single press.
        e.stopImmediatePropagation();
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKey, true);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      document.body.style.overflow = previous;
    };
  }, [handleKey]);

  // Portalled to <body>. The drawer this renders inside is a Radix
  // Dialog.Content which carries a transform for its slide animation, and a
  // transformed ancestor becomes the containing block for `position: fixed`
  // — so "fullscreen" was being clipped to the ~672px drawer column instead
  // of filling the viewport.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      // Read by the drawer's own Escape handler. Both layers listen on the
      // document in the capture phase, and the drawer registered first, so
      // stopping propagation from here cannot win the race — the outer layer
      // has to check whether an inner one is open.
      data-lightbox=""
      className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center bg-ink-950/95 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close full screen"
        className="absolute right-3 top-3 z-10 inline-flex size-9 items-center justify-center rounded-md border border-ink-600 bg-ink-900/80 text-ink-100 transition-colors hover:bg-ink-800 hover:text-ink-50"
      >
        <X className="size-4" aria-hidden />
      </button>

      <div className="relative flex max-h-full max-w-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="max-h-[88vh] w-auto max-w-[92vw] object-contain" />
        {bbox && <BBoxOverlay bbox={bbox} />}
      </div>

      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-[10px] text-ink-400">
        click anywhere or press Esc to close
      </p>
    </div>,
    document.body,
  );
}
