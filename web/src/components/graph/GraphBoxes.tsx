"use client";

import { useMemo } from "react";

import { ModalityBadge } from "@/components/ui/ModalityBadge";
import { evidenceTypeLabel } from "@/lib/modality";
import { locatorText } from "@/components/ui/SourceLocator";
import { cn } from "@/lib/utils";

import { KIND_LABEL, nodeColor, type GraphData, type GraphNode, type NodeKind } from "./model";

/**
 * The members of one node kind, as a grid of cards.
 *
 * This replaced a WebGL scene: an orbit-controlled camera over force-laid-out
 * spheres. For a bundle of a handful to a few dozen items, a 3D scene is the
 * wrong tool — orbiting and zooming to find a node is more work than reading a
 * label, and it draws attention to the *space* the graph occupies rather than
 * to the evidence in it. A card is legible at a glance: kind, modality,
 * locator and content sit in fixed positions, so comparing two nodes never
 * requires lining up a camera.
 *
 * Edges are not drawn between these cards, and that is the point of the split:
 * relationships are shown once, aggregated by kind, in <SchemaGraph />. Drawing
 * them again between individual items would be the hairball that view exists to
 * avoid. Here a card answers "what is this, exactly, and where did it come
 * from"; the graph above answers "what is connected to what".
 */

function sortKey(node: GraphNode): [number, number] {
  // Structural nodes bookend the grid — the event as the thing the query
  // reached, sources as the thing everything else derives from — with the
  // evidence itself in between, seeds before pure expansion, higher relevance
  // first within each group.
  const group = node.kind === "event" ? 0 : node.kind === "source" ? 2 : 1;
  const relevance = node.seed ? (node.score ?? node.confidence ?? 0) + 1 : (node.confidence ?? 0);
  return [group, -relevance];
}

export function GraphBoxes({
  graph,
  visibleIds,
  selectedId,
  pathIds,
  filterKind,
  onSelect,
  onHover,
}: {
  graph: GraphData;
  visibleIds: Set<string>;
  selectedId: string | null;
  /** Restricts the grid to one kind — the schema node the reader opened. */
  filterKind?: NodeKind | null;
  /** Ordered node ids forming the highlighted query path, if any — rendered
   *  as step numbers on the participating cards. */
  pathIds: string[] | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const ordered = useMemo(
    () =>
      graph.nodes
        .filter((node) => !filterKind || node.kind === filterKind)
        .sort((x, y) => {
          const [gx, rx] = sortKey(x);
          const [gy, ry] = sortKey(y);
          return gx - gy || rx - ry;
        }),
    [graph.nodes, filterKind],
  );

  const stepOf = useMemo(() => {
    const map = new Map<string, number>();
    pathIds?.forEach((id, i) => map.set(id, i + 1));
    return map;
  }, [pathIds]);

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto p-3"
      role="group"
      aria-label={`Relationship graph, ${ordered.length} nodes`}
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] items-start gap-3">
        {ordered.map((node) => (
          <NodeBox
            key={node.id}
            node={node}
            selected={selectedId === node.id}
            dimmed={!visibleIds.has(node.id)}
            step={stepOf.get(node.id) ?? null}
            connectionCount={graph.neighbours.get(node.id)?.size ?? 0}
            onSelect={onSelect}
            onHover={onHover}
          />
        ))}
      </div>
    </div>
  );
}

function NodeBox({
  node,
  selected,
  dimmed,
  step,
  connectionCount,
  onSelect,
  onHover,
}: {
  node: GraphNode;
  selected: boolean;
  dimmed: boolean;
  step: number | null;
  connectionCount: number;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const color = nodeColor(node);
  const locator = node.evidence ? locatorText(node.evidence.location) : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "group relative flex min-h-[9.5rem] flex-col rounded-lg border p-3.5 text-left transition-all duration-150",
        selected
          ? "border-signal-500/70 bg-ink-800 shadow-signal-focus"
          : "border-ink-600/70 bg-ink-850/70 hover:-translate-y-px hover:border-ink-500 hover:bg-ink-800",
        dimmed && !selected && "opacity-30 hover:opacity-60",
      )}
    >
      {step !== null && (
        <span
          aria-hidden
          className="absolute -left-2 -top-2 flex size-5 items-center justify-center rounded-full border border-signal-500/60 bg-ink-900 font-mono text-[10px] text-signal-300"
        >
          {step}
        </span>
      )}

      <div className="mb-2 flex items-center gap-2">
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-400">{KIND_LABEL[node.kind]}</span>
        {node.seed && (
          <span className="ml-auto shrink-0 rounded-sm border border-signal-600/40 bg-signal-900/40 px-1 py-px font-mono text-[9px] uppercase tracking-[0.06em] text-signal-300">
            seed
          </span>
        )}
      </div>

      {node.modality && <ModalityBadge modality={node.modality} variant="compact" className="mb-2 self-start" />}

      <p className="line-clamp-3 flex-1 text-pretty text-ui-xs leading-relaxed text-ink-100">
        {node.label || <span className="text-ink-500">No content stored.</span>}
      </p>

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-ink-700/50 pt-2">
        <span className="min-w-0 truncate font-mono text-[10px] tabular text-ink-400">
          {node.evidence
            ? (locator ?? evidenceTypeLabel(node.evidence.evidence_type))
            : node.kind === "source"
              ? `${connectionCount} evidence item${connectionCount === 1 ? "" : "s"}`
              : node.kind === "event"
                ? `${connectionCount} member${connectionCount === 1 ? "" : "s"}`
                : ""}
        </span>
        {node.score !== null && node.score !== undefined && (
          <span className="shrink-0 font-mono text-[10px] tabular text-ink-300">{node.score.toFixed(2)}</span>
        )}
      </div>
    </button>
  );
}
