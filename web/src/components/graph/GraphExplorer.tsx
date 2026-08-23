"use client";

import { ArrowLeft, GitBranch, Maximize2, Network, Route, Share2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { DemoBadge } from "@/components/ui/DemoBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PanelShell } from "@/components/ui/PanelShell";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { useEvent } from "@/lib/api/queries";
import { useWebGLSupport } from "@/hooks/useWebGLSupport";
import type { Relationship } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

import { DEFAULT_FILTERS, GraphContextRail, type GraphFilters } from "./GraphContext";
import { GraphFallback } from "./GraphFallback";
import { NodeInspector } from "./NodeInspector";
import { TimelineScrubber } from "./TimelineScrubber";
import { buildGraph, computeStats, settleLayout, type GraphData } from "./model";

const GraphCanvas = dynamic(() => import("./GraphCanvas"), { ssr: false });

export type GraphMode = "explore" | "query_path" | "lineage";

/**
 * The evidence-relationship explorer.
 *
 * Data comes from whatever the workspace already holds — the most recent query
 * response carries the evidence bundle and the relationships touching it — plus
 * the event record when an `?event=` id is present. There is no separate graph
 * endpoint on the frozen API surface, and nothing here fabricates one: if there
 * is no query and no event, the page says so rather than drawing a demo graph.
 */
export function GraphExplorer() {
  const params = useSearchParams();
  const eventIdParam = params.get("event");

  const { latestResponse, openSourceDrawer, selectEvidence } = useWorkspace();
  const eventId = eventIdParam ?? latestResponse?.primary_event_id ?? null;
  const eventQuery = useEvent(eventId);

  const [mode, setMode] = useState<GraphMode>("explore");
  const [filters, setFilters] = useState<GraphFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pathIds, setPathIds] = useState<string[] | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [railOpen, setRailOpen] = useState(false);
  const webgl = useWebGLSupport();

  const evidence = useMemo(() => latestResponse?.evidence ?? [], [latestResponse]);
  const relationships = useMemo(() => latestResponse?.relationships ?? [], [latestResponse]);

  // Seeds are the items the reranker scored; expansion-only items arrive with
  // score 0 from the query route, which is exactly the distinction the
  // query-path view needs.
  const seedIds = useMemo(
    () => new Set(evidence.filter((e) => (e.score ?? 0) > 0).map((e) => e._id)),
    [evidence],
  );

  const graph = useMemo<GraphData>(() => {
    const built = buildGraph({
      evidence,
      relationships,
      event: eventQuery.data ?? null,
      seedIds,
      includeSources: mode === "lineage",
      sources: mode === "lineage" ? sourcesFromEvidence(evidence) : [],
    });
    // Settle before first paint so the graph arrives composed rather than
    // visibly untangling itself.
    settleLayout(built);
    return built;
  }, [evidence, relationships, eventQuery.data, seedIds, mode]);

  const stats = useMemo(() => computeStats(graph), [graph]);

  const sourceNames = useMemo(() => {
    const map = new Map<string, string>();
    evidence.forEach((item) => {
      if (!map.has(item.source_id)) map.set(item.source_id, item.source_id);
    });
    return map;
  }, [evidence]);

  // ── filtering ─────────────────────────────────────────────────────
  const visibleIds = useMemo(() => {
    const allowedEdgeTypes = new Set(filters.relationshipTypes);
    const visible = new Set<string>();

    graph.nodes.forEach((node) => {
      if (node.kind === "event" || node.kind === "source") {
        visible.add(node.id);
        return;
      }
      if (filters.modalities.length > 0 && (!node.modality || !filters.modalities.includes(node.modality))) return;
      if (filters.sourceIds.length > 0 && (!node.sourceId || !filters.sourceIds.includes(node.sourceId))) return;

      if (filters.timeWindow) {
        if (node.startMs === null) {
          if (!filters.includeUntimed) return;
        } else {
          const end = node.endMs ?? node.startMs;
          if (end < filters.timeWindow.startMs || node.startMs > filters.timeWindow.endMs) return;
        }
      }
      visible.add(node.id);
    });

    // Edge-level filters remove the nodes that only existed because of an
    // edge that is now filtered out — otherwise a confidence threshold leaves
    // orphans floating with no visible reason to be there.
    if (filters.minConfidence > 0 || allowedEdgeTypes.size > 0 || filters.statuses.length < 2) {
      const kept = new Set<string>();
      graph.edges.forEach((edge) => {
        if (edge.confidence < filters.minConfidence) return;
        if (allowedEdgeTypes.size > 0 && !allowedEdgeTypes.has(edge.type)) return;
        if (edge.status !== "rejected" && !filters.statuses.includes(edge.status)) return;
        kept.add(edge.from);
        kept.add(edge.to);
      });
      graph.nodes.forEach((node) => {
        if (node.kind === "event") kept.add(node.id);
        if (!kept.has(node.id)) visible.delete(node.id);
      });
    }

    return visible;
  }, [graph, filters]);

  // ── query path ────────────────────────────────────────────────────
  /** query → seed → event → expanded → parent proof. Built from real data:
   *  the seed is the highest-scoring node, the event is the one the backend
   *  reported, and the tail follows actual edges. */
  const buildQueryPath = useCallback(
    (targetId?: string) => {
      const path: string[] = [];
      const bestSeed = graph.nodes
        .filter((n) => n.seed)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
      if (bestSeed) path.push(bestSeed.id);
      if (eventQuery.data && graph.nodesById.has(eventQuery.data._id)) path.push(eventQuery.data._id);

      if (targetId && targetId !== path[path.length - 1] && graph.nodesById.has(targetId)) {
        path.push(targetId);
        const parent = graph.nodesById.get(targetId)?.evidence?.parent_evidence_id;
        if (parent && graph.nodesById.has(parent)) path.push(parent);
      }
      return path.length >= 2 ? path : null;
    },
    [graph, eventQuery.data],
  );

  const activatePath = useCallback(
    (targetId?: string) => {
      // Always enter the mode, even when no path can be built — the legend
      // explains why one is unavailable. Silently bouncing back to Explore
      // would look like the control was broken, and would also hide the
      // legitimate case where the event record simply has not loaded yet.
      setPathIds(buildQueryPath(targetId));
      setMode("query_path");
    },
    [buildQueryPath],
  );

  // Once the event record arrives, a path that could not be built at click
  // time becomes buildable; recompute rather than leaving it empty.
  useEffect(() => {
    if (mode !== "query_path" || pathIds) return;
    const path = buildQueryPath();
    if (path) setPathIds(path);
  }, [mode, pathIds, buildQueryPath]);

  useEffect(() => {
    if (mode !== "query_path") setPathIds(null);
  }, [mode]);

  const selectedNode = selectedId ? (graph.nodesById.get(selectedId) ?? null) : null;

  const selectedRelationships: Relationship[] = useMemo(() => {
    if (!selectedId) return [];
    return relationships.filter((r) => r.from_id === selectedId || r.to_id === selectedId);
  }, [relationships, selectedId]);

  const focusSubgraph = useCallback(
    (id: string) => {
      const neighbourhood = new Set<string>([id]);
      graph.neighbours.get(id)?.forEach((n) => neighbourhood.add(n));
      setSelectedId(id);
    },
    [graph],
  );

  // ── empty / error states ──────────────────────────────────────────
  const hasGraph = graph.nodes.length > 0;

  return (
    <div className="grid min-h-0 flex-1 lg:grid-cols-[22rem_minmax(0,1fr)]">
      {/* ── context rail ────────────────────────────────────────── */}
      <PanelShell
        as="aside"
        label="Investigation context"
        className={cn(
          "min-h-0 border-r border-ink-600/70 bg-ink-850/60",
          railOpen ? "fixed inset-y-0 left-0 z-40 w-[min(22rem,90vw)] shadow-drawer" : "hidden lg:flex",
        )}
        title={
          <div className="flex min-w-0 items-center gap-2">
            <Button asChild size="icon-sm" variant="ghost" aria-label="Back to workspace">
              <Link href="/workspace">
                <ArrowLeft />
              </Link>
            </Button>
            <span className="truncate text-ui-sm font-medium text-ink-50">Evidence graph</span>
          </div>
        }
        actions={<DemoBadge />}
      >
        {eventQuery.isError && eventId ? (
          <ErrorState
            compact
            error={eventQuery.error}
            title="Could not load the event"
            onRetry={() => void eventQuery.refetch()}
            retrying={eventQuery.isFetching}
          />
        ) : null}

        <GraphContextRail
          event={eventQuery.data ?? null}
          stats={stats}
          filters={filters}
          onFiltersChange={setFilters}
          response={latestResponse}
          sourceNames={sourceNames}
          nodeCount={graph.nodes.length}
          visibleCount={visibleIds.size}
        />
      </PanelShell>

      {railOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-ink-950/70 backdrop-blur-sm lg:hidden"
          onClick={() => setRailOpen(false)}
          aria-label="Close investigation context"
        />
      )}

      {/* ── canvas ──────────────────────────────────────────────── */}
      <section className="relative flex min-h-0 min-w-0 flex-col bg-ink-900" aria-label="Relationship graph">
        {/* toolbar */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink-600/70 px-3 py-2">
          <Button
            size="icon-sm"
            variant="ghost"
            className="lg:hidden"
            onClick={() => setRailOpen(true)}
            aria-label="Open investigation context"
          >
            <Network />
          </Button>

          <div className="flex items-center gap-1 rounded-md border border-ink-600 p-0.5" role="group" aria-label="Graph mode">
            {(
              [
                ["explore", "Explore", Network],
                ["query_path", "Query path", Route],
                ["lineage", "Lineage", GitBranch],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  if (value === "query_path") activatePath();
                }}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-ui-xs transition-colors",
                  mode === value ? "bg-ink-700 text-ink-50" : "text-ink-300 hover:bg-ink-750 hover:text-ink-100",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          <p className="hidden text-ui-2xs text-ink-400 md:block">
            {mode === "explore" && "Drag to orbit · scroll to zoom · click to select · double-click to focus"}
            {mode === "query_path" && "query → seed result → event → expansion → parent proof"}
            {mode === "lineage" && "raw source → derived evidence → event"}
          </p>

          <div className="ml-auto flex items-center gap-1.5">
            <Button size="xs" variant="ghost" onClick={() => setResetSignal((n) => n + 1)}>
              <Maximize2 />
              Reset camera
            </Button>
          </div>
        </div>

        {/* canvas surface */}
        <div className="relative min-h-0 flex-1">
          <div className="grid-field absolute inset-0 opacity-40" aria-hidden />

          {!hasGraph ? (
            <EmptyState
              icon={Share2}
              title="No graph to draw"
              description={
                eventId
                  ? "The event loaded, but this workspace holds no evidence bundle to place around it. Run a query in the workspace first — the graph is built from the evidence and relationships that query returns."
                  : "Run a query in the workspace first. The graph is built from the evidence bundle and relationships the query returns, plus the event it reached."
              }
              action={{ label: "Go to workspace", onClick: () => (window.location.href = "/workspace") }}
            />
          ) : webgl === false ? (
            <GraphFallback graph={graph} visibleIds={visibleIds} selectedId={selectedId} onSelect={setSelectedId} />
          ) : webgl === true ? (
            <GraphCanvas
              graph={graph}
              selectedId={selectedId}
              hoveredId={hoveredId}
              visibleIds={visibleIds}
              pathIds={mode === "query_path" ? pathIds : null}
              onSelect={setSelectedId}
              onHover={setHoveredId}
              onFocusSubgraph={focusSubgraph}
              resetSignal={resetSignal}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="skeleton size-40 rounded-full" aria-hidden />
              <span className="sr-only">Preparing graph</span>
            </div>
          )}

          {/* path legend, only while the mode is active */}
          {mode === "query_path" && hasGraph && (
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-ink-600/70 bg-ink-850/90 p-2.5 backdrop-blur">
              <p className="eyebrow mb-1.5">Query path</p>
              {pathIds ? (
                <ol className="space-y-0.5">
                  {["seed result", "semantic event", "expanded evidence", "parent proof"]
                    .slice(0, pathIds.length)
                    .map((label, i) => (
                      <li key={label} className="flex items-center gap-2 font-mono text-[10px] text-ink-200">
                        <span className="text-signal-400">{i + 1}</span>
                        {label}
                      </li>
                    ))}
                </ol>
              ) : (
                <p className="max-w-[16rem] text-[10.5px] leading-relaxed text-ink-400">
                  No path available — this query produced no scored seed, or no event was reached by expansion.
                </p>
              )}
            </div>
          )}

          {/* timeline */}
          {hasGraph && (
            <div className="pointer-events-auto absolute inset-x-3 bottom-3 lg:left-auto lg:right-3 lg:w-[26rem]">
              <TimelineScrubber
                nodes={graph.nodes.filter((n) => n.kind === "observation" || n.kind === "segment")}
                range={stats.timeRange}
                window={filters.timeWindow}
                onWindowChange={(timeWindow) => setFilters((f) => ({ ...f, timeWindow }))}
                includeUntimed={filters.includeUntimed}
                onIncludeUntimedChange={(includeUntimed) => setFilters((f) => ({ ...f, includeUntimed }))}
              />
            </div>
          )}
        </div>
      </section>

      {/* ── node inspector ──────────────────────────────────────── */}
      {selectedNode && (
        <aside
          className="fixed inset-y-0 right-0 z-30 w-[min(23rem,92vw)] overflow-y-auto border-l border-ink-600/70 bg-ink-850 shadow-drawer"
          aria-label="Node inspector"
        >
          <div className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b border-ink-600/70 bg-ink-850 px-3">
            <h2 className="text-ui-sm font-medium text-ink-50">Node</h2>
            <Button
              size="icon-sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => setSelectedId(null)}
              aria-label="Close node inspector"
            >
              <ArrowLeft />
            </Button>
          </div>
          <NodeInspector
            node={selectedNode}
            graph={graph}
            relationships={selectedRelationships}
            onSelect={setSelectedId}
            onTracePath={(id) => activatePath(id)}
            onOpenEvidence={(id) => {
              selectEvidence(id);
              openSourceDrawer(id);
            }}
          />
        </aside>
      )}
    </div>
  );
}

/** Minimal Source stubs for lineage mode. The graph only needs an id and a
 *  label; the full record lives behind `Inspect source`. */
function sourcesFromEvidence(evidence: { source_id: string }[]) {
  const seen = new Set<string>();
  const result: import("@/lib/api/schemas").Source[] = [];
  evidence.forEach((item) => {
    if (seen.has(item.source_id)) return;
    seen.add(item.source_id);
    result.push({
      _id: item.source_id,
      collection_id: "",
      filename: item.source_id,
      media_type: "unknown",
      mime_type: "",
      sha256: "",
      size_bytes: 0,
      status: "ready",
      storage_path: "",
    } as import("@/lib/api/schemas").Source);
  });
  return result;
}
