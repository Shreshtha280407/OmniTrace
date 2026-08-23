"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";

import { nodeColor, nodeRadius, type GraphData } from "./model";

/**
 * SVG fallback for the relationship graph.
 *
 * Same layout, same colours, same selection behaviour — it uses the already
 * settled positions from the force pass and simply projects them orthographically.
 * Not a downgrade notice: a real, clickable graph without WebGL.
 */
export function GraphFallback({
  graph,
  visibleIds,
  selectedId,
  onSelect,
}: {
  graph: GraphData;
  visibleIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Fit the settled layout to the viewBox rather than assuming a scale.
  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    graph.nodes.forEach((node) => {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
    });
    if (!Number.isFinite(minX)) return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const padX = (maxX - minX) * 0.12 + 1;
    const padY = (maxY - minY) * 0.12 + 1;
    return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
  }, [graph]);

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const project = (x: number, y: number) => ({
    cx: ((x - bounds.minX) / width) * 1000,
    // SVG y grows downward; the layout's does not.
    cy: 1000 - ((y - bounds.minY) / height) * 1000,
  });

  return (
    <div className="absolute inset-0 overflow-auto">
      <svg
        viewBox="0 0 1000 1000"
        className="h-full min-h-[24rem] w-full"
        role="group"
        aria-label={`Relationship graph, ${graph.nodes.length} nodes and ${graph.edges.length} relationships`}
      >
        <g>
          {graph.edges.map((edge) => {
            const from = graph.nodesById.get(edge.from);
            const to = graph.nodesById.get(edge.to);
            if (!from || !to) return null;
            const a = project(from.x, from.y);
            const b = project(to.x, to.y);
            const dim = !visibleIds.has(edge.from) || !visibleIds.has(edge.to);
            return (
              <line
                key={edge.id}
                x1={a.cx}
                y1={a.cy}
                x2={b.cx}
                y2={b.cy}
                stroke={edge.status === "confirmed" ? "#19D6C4" : "#7A6DC9"}
                strokeWidth={edge.status === "confirmed" ? 1.1 : 0.8}
                strokeDasharray={edge.status === "confirmed" ? undefined : "4 4"}
                strokeOpacity={dim ? 0.06 : 0.2 + edge.confidence * 0.45}
              />
            );
          })}
        </g>

        <g>
          {graph.nodes.map((node) => {
            const { cx, cy } = project(node.x, node.y);
            const r = nodeRadius(node) * 44;
            const dim = !visibleIds.has(node.id);
            const selected = selectedId === node.id;
            return (
              <g key={node.id} opacity={dim ? 0.18 : 1}>
                {(selected || node.seed) && (
                  <circle cx={cx} cy={cy} r={r * 2} fill={nodeColor(node)} fillOpacity={selected ? 0.18 : 0.09} />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={nodeColor(node)}
                  stroke={selected ? "#E8ECF2" : "transparent"}
                  strokeWidth={1.5}
                  className="cursor-pointer"
                  onClick={() => onSelect(node.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(node.id);
                    }
                  }}
                >
                  <title>{node.label}</title>
                </circle>
                {(selected || node.kind === "event") && (
                  <text
                    x={cx}
                    y={cy - r - 6}
                    textAnchor="middle"
                    fontSize={node.kind === "event" ? 15 : 12}
                    fontFamily="monospace"
                    fill={selected ? "#E8ECF2" : "#8B96A8"}
                  >
                    {node.label.slice(0, 42)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <p
        className={cn(
          "pointer-events-none absolute left-3 top-3 rounded-md border border-ink-600/70",
          "bg-ink-850/90 px-2.5 py-1.5 font-mono text-[10px] text-ink-400 backdrop-blur",
        )}
      >
        WebGL unavailable — rendering the settled layout as SVG. Selection and filters still work; orbit and zoom do not.
      </p>
    </div>
  );
}
