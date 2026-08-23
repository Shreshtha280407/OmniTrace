"use client";

import { Clock, RotateCcw } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { formatTimecode } from "@/lib/format";
import { modalityMeta } from "@/lib/modality";
import { cn } from "@/lib/utils";

import type { GraphNode } from "./model";

/**
 * Timeline scrubber.
 *
 * Filters time-bearing evidence only. Documents and images have no timeline
 * position (§06 Location rules), so they are counted separately and governed
 * by an explicit "keep untimed evidence" switch — dragging the window must
 * never silently hide a PDF by pretending it happened at some moment.
 */
export function TimelineScrubber({
  nodes,
  range,
  window: activeWindow,
  onWindowChange,
  includeUntimed,
  onIncludeUntimedChange,
}: {
  nodes: GraphNode[];
  range: { startMs: number; endMs: number } | null;
  window: { startMs: number; endMs: number } | null;
  onWindowChange: (next: { startMs: number; endMs: number } | null) => void;
  includeUntimed: boolean;
  onIncludeUntimedChange: (next: boolean) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);

  const timed = useMemo(() => nodes.filter((n) => n.startMs !== null), [nodes]);
  const untimedCount = nodes.length - timed.length;

  if (!range || timed.length === 0) {
    return (
      <div className="rounded-lg border border-ink-600/70 bg-ink-850/70 px-3 py-2.5">
        <div className="mb-1 flex items-center gap-2">
          <Clock className="size-3.5 text-ink-500" aria-hidden />
          <span className="eyebrow">Timeline</span>
        </div>
        <p className="text-ui-2xs leading-relaxed text-ink-400">
          No time-bearing evidence in this graph. All {nodes.length} nodes are page- or region-located.
        </p>
      </div>
    );
  }

  const span = Math.max(1, range.endMs - range.startMs);
  const win = activeWindow ?? range;
  const toPercent = (ms: number) => ((ms - range.startMs) / span) * 100;
  const fromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return range.startMs;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(range.startMs + ratio * span);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragging) return;
    const ms = fromClientX(event.clientX);
    // Handles cannot cross: dragging start past end clamps rather than
    // inverting the window.
    if (dragging === "start") onWindowChange({ startMs: Math.min(ms, win.endMs - 100), endMs: win.endMs });
    else onWindowChange({ startMs: win.startMs, endMs: Math.max(ms, win.startMs + 100) });
  };

  const filtered = activeWindow
    ? timed.filter((n) => (n.endMs ?? n.startMs!) >= win.startMs && n.startMs! <= win.endMs).length
    : timed.length;

  return (
    <div className="rounded-lg border border-ink-600/70 bg-ink-850/70 px-3 py-2.5">
      <div className="mb-2.5 flex items-center gap-2">
        <Clock className="size-3.5 text-signal-400" aria-hidden />
        <span className="eyebrow">Timeline</span>
        <span className="ml-auto font-mono text-ui-2xs tabular text-ink-300">
          {filtered} of {timed.length} timed
        </span>
        {activeWindow && (
          <Button size="icon-sm" variant="ghost" onClick={() => onWindowChange(null)} aria-label="Reset time window">
            <RotateCcw />
          </Button>
        )}
      </div>

      <div
        ref={trackRef}
        className="relative h-10 touch-none select-none"
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(null)}
        onPointerLeave={() => setDragging(null)}
      >
        {/* evidence ticks, coloured by modality */}
        <div className="absolute inset-x-0 top-0 h-6">
          {timed.map((node) => {
            const left = toPercent(node.startMs!);
            const width = Math.max(0.4, toPercent(node.endMs ?? node.startMs!) - left);
            const inWindow = (node.endMs ?? node.startMs!) >= win.startMs && node.startMs! <= win.endMs;
            return (
              <span
                key={node.id}
                className={cn("absolute top-1 h-4 rounded-[1px] transition-opacity", inWindow ? "opacity-85" : "opacity-20")}
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: modalityMeta(node.modality).hex,
                }}
                title={`${formatTimecode(node.startMs)} · ${node.label.slice(0, 60)}`}
              />
            );
          })}
        </div>

        {/* track + window */}
        <div className="absolute inset-x-0 top-7 h-1 rounded-full bg-ink-700">
          <div
            className="absolute inset-y-0 rounded-full bg-signal-500/50"
            style={{ left: `${toPercent(win.startMs)}%`, right: `${100 - toPercent(win.endMs)}%` }}
          />
        </div>

        {/* handles */}
        {(["start", "end"] as const).map((handle) => {
          const ms = handle === "start" ? win.startMs : win.endMs;
          return (
            <button
              key={handle}
              type="button"
              role="slider"
              aria-label={`${handle === "start" ? "Window start" : "Window end"}, ${formatTimecode(ms)}`}
              aria-valuemin={range.startMs}
              aria-valuemax={range.endMs}
              aria-valuenow={ms}
              aria-valuetext={formatTimecode(ms)}
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                setDragging(handle);
              }}
              onKeyDown={(e) => {
                const step = span / 40;
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                const delta = e.key === "ArrowLeft" ? -step : step;
                const next = Math.min(range.endMs, Math.max(range.startMs, ms + delta));
                if (handle === "start") onWindowChange({ startMs: Math.min(next, win.endMs - 100), endMs: win.endMs });
                else onWindowChange({ startMs: win.startMs, endMs: Math.max(next, win.startMs + 100) });
              }}
              className="absolute top-[22px] size-3 -translate-x-1/2 cursor-ew-resize rounded-full border-2 border-ink-900 bg-signal-400 transition-transform hover:scale-125"
              style={{ left: `${toPercent(ms)}%` }}
            />
          );
        })}
      </div>

      <div className="mt-1 flex items-center justify-between font-mono text-[10px] tabular text-ink-400">
        <span>{formatTimecode(win.startMs)}</span>
        <span>{formatTimecode(win.endMs)}</span>
      </div>

      {untimedCount > 0 && (
        <label className="mt-2 flex items-center gap-2 border-t border-ink-600/50 pt-2 text-ui-2xs text-ink-300">
          <input
            type="checkbox"
            checked={includeUntimed}
            onChange={(e) => onIncludeUntimedChange(e.target.checked)}
            className="size-3 accent-signal-500"
          />
          Keep {untimedCount} untimed {untimedCount === 1 ? "item" : "items"} visible
          <span className="text-ink-500">(documents, images)</span>
        </label>
      )}
    </div>
  );
}
