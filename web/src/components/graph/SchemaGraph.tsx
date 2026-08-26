"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils";

import {
  KIND_COLOR,
  KIND_LABEL,
  SCHEMA_KIND_ORDER,
  type NodeKind,
  type SchemaEdge,
  type SchemaGraphData,
} from "./model";

/**
 * The five-node relationship graph.
 *
 * Five nodes, always the same five, laid out on a regular pentagon. The
 * regularity is not styling: on a convex polygon every chord between two
 * vertices touches the boundary only at its endpoints, so no edge can ever be
 * hidden behind an unrelated node. A force layout gives no such guarantee and
 * would also move the nodes between queries, which is the opposite of what
 * this view is for — the nodes are the fixed frame, and the reader should be
 * watching the edges, not re-finding the boxes.
 *
 * Edges animate in, staggered and strongest-first, because the relationships
 * genuinely are derived per query: they are the part of the picture the
 * linker decided. Status is carried by weight rather than by dashes —
 * confirmed edges settle opaque and still, tentative ones stay faint and keep
 * breathing, so "not settled" is legible without reading a legend.
 */

const NODE_HALF_W = 68;
const NODE_HALF_H = 30;

interface Placed {
  kind: NodeKind;
  x: number;
  y: number;
  /** Outward unit vector from the centre — self-loops bulge along it. */
  nx: number;
  ny: number;
}

/** Where a ray leaving a box centre crosses the box boundary. Edges stop
 *  there rather than at the centre, so a line never appears to pass under a
 *  node it has nothing to do with. */
function boundaryPoint(from: Placed, dx: number, dy: number) {
  const scale = Math.min(
    Math.abs(dx) < 1e-6 ? Infinity : (NODE_HALF_W + 6) / Math.abs(dx),
    Math.abs(dy) < 1e-6 ? Infinity : (NODE_HALF_H + 6) / Math.abs(dy),
  );
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

function edgePath(edge: SchemaEdge, at: Map<NodeKind, Placed>): string | null {
  const a = at.get(edge.from);
  const b = at.get(edge.to);
  if (!a || !b) return null;

  if (edge.from === edge.to) {
    // Self-loop: relationships between two items of the same kind, which is
    // the common case for evidence. Bulges outward, away from the centre, so
    // it never crosses the interior where the chords live.
    const px = -a.ny;
    const py = a.nx;
    const start = {
      x: a.x + px * 26 + a.nx * 18,
      y: a.y + py * 26 + a.ny * 18,
    };
    const end = { x: a.x - px * 26 + a.nx * 18, y: a.y - py * 26 + a.ny * 18 };
    const reach = 74;
    return [
      `M ${start.x} ${start.y}`,
      `C ${start.x + a.nx * reach + px * 20} ${start.y + a.ny * reach + py * 20}`,
      `${end.x + a.nx * reach - px * 20} ${end.y + a.ny * reach - py * 20}`,
      `${end.x} ${end.y}`,
    ].join(" ");
  }

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const start = boundaryPoint(a, dx, dy);
  const end = boundaryPoint(b, -dx, -dy);

  // A small bow, sided by the lexical order of the endpoints, so that A→B and
  // B→A stay visibly separate instead of overdrawing each other.
  const side = edge.from < edge.to ? 1 : -1;
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const bow = Math.min(30, length * 0.13) * side;
  const cx = mx + (-(end.y - start.y) / length) * bow;
  const cy = my + ((end.x - start.x) / length) * bow;

  return `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`;
}

/** Midpoint of the quadratic/cubic above, for label placement. */
function labelPoint(edge: SchemaEdge, at: Map<NodeKind, Placed>) {
  const a = at.get(edge.from);
  const b = at.get(edge.to);
  if (!a || !b) return null;

  if (edge.from === edge.to) {
    return { x: a.x + a.nx * 92, y: a.y + a.ny * 92 };
  }

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const start = boundaryPoint(a, dx, dy);
  const end = boundaryPoint(b, -dx, -dy);
  const side = edge.from < edge.to ? 1 : -1;
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const bow = Math.min(30, length * 0.13) * side;
  // At t=0.5 a quadratic sits halfway between the chord midpoint and the
  // control point, so the label lands on the curve rather than beside it.
  return {
    x: (start.x + end.x) / 2 + (-(end.y - start.y) / length) * bow * 0.5,
    y: (start.y + end.y) / 2 + ((end.x - start.x) / length) * bow * 0.5,
  };
}

function strokeWidth(edge: SchemaEdge): number {
  return Math.min(4.5, 1.1 + Math.log2(1 + edge.count) * 0.75);
}

export function SchemaGraph({
  schema,
  selectedKind,
  onSelectKind,
  pathKinds,
  className,
}: {
  schema: SchemaGraphData;
  selectedKind: NodeKind | null;
  onSelectKind: (kind: NodeKind | null) => void;
  /** Ordered kinds along the active query path, numbered on the nodes. */
  pathKinds: NodeKind[] | null;
  className?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoveredKind, setHoveredKind] = useState<NodeKind | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const placed = useMemo(() => {
    const map = new Map<NodeKind, Placed>();
    const { width, height } = size;
    if (width === 0 || height === 0) return map;

    const cx = width / 2;
    const cy = height / 2;
    // Leaves room for the self-loops, which reach furthest outward, and for
    // the box itself at each vertex.
    const rx = Math.max(120, Math.min(width / 2 - NODE_HALF_W - 96, 300));
    const ry = Math.max(96, Math.min(height / 2 - NODE_HALF_H - 84, 210));

    SCHEMA_KIND_ORDER.forEach((kind, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / SCHEMA_KIND_ORDER.length;
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      map.set(kind, { kind, x: cx + nx * rx, y: cy + ny * ry, nx, ny });
    });
    return map;
  }, [size]);

  // Remounting on this signature is what makes the edges re-form when the
  // underlying relationships change — a new query, or a filter that removes
  // the evidence an edge rested on.
  const formationKey = useMemo(
    () => schema.edges.map((e) => `${e.id}:${e.count}:${e.status}`).join("|"),
    [schema.edges],
  );

  const emphasised = hoveredKind ?? selectedKind;
  const ready = placed.size > 0;

  return (
    <div
      ref={hostRef}
      className={cn("relative min-h-0 w-full", className)}
      role="group"
      aria-label={`Schema graph, ${schema.nodes.length} node kinds and ${schema.edges.length} relationship groups`}
    >
      {ready && (
        <svg
          key={formationKey}
          className="pointer-events-none absolute inset-0 size-full overflow-visible"
          aria-hidden
        >
          {schema.edges.map((edge, i) => {
            const d = edgePath(edge, placed);
            const label = labelPoint(edge, placed);
            if (!d || !label) return null;

            const involved = emphasised === null || edge.from === emphasised || edge.to === emphasised;
            const confirmed = edge.status === "confirmed";
            const color = confirmed ? "#19D6C4" : "#8A96A8";
            // Confirmed edges settle; tentative ones stay faint — the whole
            // status encoding, with no legend to consult.
            const restOpacity = (confirmed ? 0.72 : 0.42) * (involved ? 1 : 0.18);
            const delay = reducedMotion ? 0 : i * 130;

            return (
              <g key={edge.id}>
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={strokeWidth(edge)}
                  strokeLinecap="round"
                  // pathLength normalises any curve to 1, so one dash pattern
                  // draws a chord and a self-loop identically.
                  pathLength={1}
                  strokeDasharray={1}
                  style={{
                    opacity: restOpacity,
                    // The breathe keyframe reads this rather than a literal,
                    // so hover dimming still works on an edge mid-animation:
                    // an animated `opacity` would otherwise win outright.
                    ["--schema-edge-opacity" as string]: restOpacity,
                    transition: "opacity 180ms ease",
                    ...(reducedMotion
                      ? { strokeDashoffset: 0 }
                      : {
                          strokeDashoffset: 1,
                          animation: `schema-edge-draw 620ms cubic-bezier(0.22,0.61,0.36,1) ${delay}ms forwards${
                            confirmed ? "" : `, schema-edge-breathe 2.8s ease-in-out ${delay + 620}ms infinite`
                          }`,
                        }),
                  }}
                />
                <text
                  x={label.x}
                  y={label.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="font-mono"
                  fontSize={9.5}
                  fill={confirmed ? "#C8D0DA" : "#8A96A8"}
                  stroke="#0D1117"
                  strokeWidth={3.5}
                  paintOrder="stroke"
                  style={{
                    opacity: involved ? 1 : 0.15,
                    ...(reducedMotion
                      ? {}
                      : {
                          animation: `schema-label-in 300ms ease ${delay + 480}ms both`,
                        }),
                  }}
                >
                  {edge.dominantType} · {edge.count}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {ready &&
        schema.nodes.map((node) => {
          const at = placed.get(node.kind)!;
          const step = pathKinds ? pathKinds.indexOf(node.kind) : -1;
          const empty = node.count === 0;
          const dimmed = emphasised !== null && emphasised !== node.kind;

          return (
            <button
              key={node.kind}
              type="button"
              disabled={empty}
              onClick={() => onSelectKind(selectedKind === node.kind ? null : node.kind)}
              onMouseEnter={() => setHoveredKind(node.kind)}
              onMouseLeave={() => setHoveredKind(null)}
              onFocus={() => setHoveredKind(node.kind)}
              onBlur={() => setHoveredKind(null)}
              aria-pressed={selectedKind === node.kind}
              className={cn(
                "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-xl border px-3 py-2 text-center transition-all duration-200",
                selectedKind === node.kind
                  ? "border-signal-500/70 bg-ink-800 shadow-signal-focus"
                  : "border-ink-600/80 bg-ink-850/95 backdrop-blur-sm",
                !empty && selectedKind !== node.kind && "hover:border-ink-500 hover:bg-ink-800",
                // An unpopulated kind still appears, and has to stay legible:
                // the five are the schema, not a summary of what this query
                // happened to return. Dashed says "nothing in it", not "barely
                // here" — at 45% opacity it read as a rendering glitch.
                empty && "border-dashed border-ink-600/70 bg-ink-900/70 opacity-80",
                dimmed && "opacity-40",
              )}
              style={{
                left: at.x,
                top: at.y,
                width: NODE_HALF_W * 2,
                minHeight: NODE_HALF_H * 2,
              }}
            >
              {step >= 0 && (
                <span
                  aria-hidden
                  className="absolute -left-2 -top-2 flex size-5 items-center justify-center rounded-full border border-signal-500/60 bg-ink-900 font-mono text-[10px] text-signal-300"
                >
                  {step + 1}
                </span>
              )}

              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: KIND_COLOR[node.kind] }}
                />
                <span className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-ink-300">
                  {KIND_LABEL[node.kind]}
                </span>
              </span>

              <span className="mt-0.5 font-display text-ui-lg tabular text-ink-50">{empty ? "—" : node.count}</span>

              {node.totalCount > node.count && (
                <span className="font-mono text-[9px] text-ink-500">of {node.totalCount}</span>
              )}
            </button>
          );
        })}

      {ready && schema.edges.length === 0 && (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-ui-2xs text-ink-500">
          No relationships between these nodes yet.
        </p>
      )}
    </div>
  );
}
