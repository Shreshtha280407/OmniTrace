import type { EvidenceItem, Relationship, SemanticEvent, Source } from "@/lib/api/schemas";
import { modalityMeta } from "@/lib/modality";

/**
 * Graph model.
 *
 * Turns the API's evidence + relationships + event into nodes and edges, and
 * runs the force layout. Deliberately framework-free so it can be unit tested
 * and so the WebGL layer only ever consumes positions.
 *
 * Node kinds are distinct object types in the data model, not visual variety
 * for its own sake: an observation, a segment, an event and a source are
 * different things and are drawn differently.
 */

export type NodeKind = "observation" | "segment" | "event" | "source" | "entity";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  modality: string | null;
  /** Bundle rerank score where the API supplied one; drives radius. */
  score: number | null;
  confidence: number | null;
  /** Time position, only for evidence that genuinely has one. */
  startMs: number | null;
  endMs: number | null;
  sourceId: string | null;
  /** Matched directly by retrieval (as opposed to reached by expansion). */
  seed: boolean;
  evidence?: EvidenceItem;
  // layout
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Pinned nodes do not move (the event anchors the layout). */
  fixed: boolean;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  status: "confirmed" | "tentative" | "rejected";
  confidence: number;
  signals: Record<string, number | null | undefined>;
  sameTimeline: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodesById: Map<string, GraphNode>;
  /** Adjacency for 1-hop highlighting, both directions. */
  neighbours: Map<string, Set<string>>;
}

export interface BuildGraphInput {
  evidence: EvidenceItem[];
  relationships: Relationship[];
  event?: SemanticEvent | null;
  sources?: Source[];
  /** Evidence ids that came from seed retrieval rather than expansion. */
  seedIds?: Set<string>;
  /** Include a node per source, with a PART_OF edge to its evidence. */
  includeSources?: boolean;
}

/** Deterministic pseudo-random in [0,1) from a string — a stable starting
 *  layout means the graph does not reshuffle on every render. */
function hashUnit(input: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export function buildGraph({
  evidence,
  relationships,
  event,
  sources = [],
  seedIds,
  includeSources = false,
}: BuildGraphInput): GraphData {
  const nodes: GraphNode[] = [];
  const nodesById = new Map<string, GraphNode>();

  const push = (node: GraphNode) => {
    if (nodesById.has(node.id)) return;
    nodes.push(node);
    nodesById.set(node.id, node);
  };

  // Seed positions on a sphere so the force pass starts spread out rather than
  // exploding out of a single point.
  const place = (id: string, radius: number) => {
    const u = hashUnit(id, 1);
    const v = hashUnit(id, 2);
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    return {
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: radius * Math.sin(phi) * Math.sin(theta),
      z: radius * Math.cos(phi) * 0.55, // flattened: readability beats a true ball
    };
  };

  if (event) {
    push({
      id: event._id,
      kind: "event",
      label: event.title,
      modality: null,
      score: null,
      confidence: event.confidence,
      startMs: event.start_ms ?? null,
      endMs: event.end_ms ?? null,
      sourceId: null,
      seed: false,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      fixed: true, // the event anchors the whole layout
    });
  }

  evidence.forEach((item) => {
    const position = place(item._id, 5.5);
    push({
      id: item._id,
      kind: item.node_type === "semantic_segment" ? "segment" : "observation",
      label: item.content.slice(0, 90),
      modality: item.modality,
      score: item.score ?? null,
      confidence: item.confidence?.extraction ?? null,
      startMs: item.location?.start_ms ?? null,
      endMs: item.location?.end_ms ?? null,
      sourceId: item.source_id,
      seed: seedIds ? seedIds.has(item._id) : false,
      evidence: item,
      ...position,
      vx: 0, vy: 0, vz: 0,
      fixed: false,
    });
  });

  if (includeSources) {
    sources.forEach((source) => {
      const position = place(source._id, 8);
      push({
        id: source._id,
        kind: "source",
        label: source.filename,
        modality: null,
        score: null,
        confidence: null,
        startMs: null,
        endMs: null,
        sourceId: source._id,
        seed: false,
        ...position,
        vx: 0, vy: 0, vz: 0,
        fixed: false,
      });
    });
  }

  const edges: GraphEdge[] = [];
  const neighbours = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    if (!neighbours.has(b)) neighbours.set(b, new Set());
    neighbours.get(a)!.add(b);
    neighbours.get(b)!.add(a);
  };

  relationships.forEach((rel) => {
    // An edge to a node we do not have would render as a line into empty
    // space; drop it rather than inventing the missing endpoint.
    if (!nodesById.has(rel.from_id) || !nodesById.has(rel.to_id)) return;
    edges.push({
      id: rel._id,
      from: rel.from_id,
      to: rel.to_id,
      type: rel.type,
      status: rel.status,
      confidence: rel.confidence,
      signals: rel.signals as Record<string, number | null | undefined>,
      sameTimeline: Boolean(rel.same_timeline),
    });
    link(rel.from_id, rel.to_id);
  });

  // Membership edges: event → members, and source → evidence when sources are
  // shown. These are structural facts from the records, not inferred links.
  if (event) {
    event.member_ids.forEach((memberId) => {
      if (!nodesById.has(memberId)) return;
      const id = `member_${event._id}_${memberId}`;
      edges.push({
        id,
        from: event._id,
        to: memberId,
        type: "PART_OF_EVENT",
        status: "confirmed",
        confidence: event.confidence,
        signals: {},
        sameTimeline: false,
      });
      link(event._id, memberId);
    });
  }

  if (includeSources) {
    evidence.forEach((item) => {
      if (!nodesById.has(item.source_id)) return;
      const id = `derived_${item.source_id}_${item._id}`;
      edges.push({
        id,
        from: item.source_id,
        to: item._id,
        type: "DERIVED_FROM",
        status: "confirmed",
        confidence: 1,
        signals: {},
        sameTimeline: false,
      });
      link(item.source_id, item._id);
    });
  }

  return { nodes, edges, nodesById, neighbours };
}

// ── force layout ───────────────────────────────────────────────────────────

export interface LayoutOptions {
  /** Edges pull; higher is tighter. */
  linkStrength: number;
  /** All nodes push each other apart. */
  repulsion: number;
  /** Pull toward origin, keeps disconnected components on screen. */
  centering: number;
  damping: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  linkStrength: 0.045,
  repulsion: 2.4,
  centering: 0.012,
  damping: 0.86,
};

/**
 * One step of a Barnes-Hut-free O(n²) force simulation.
 *
 * O(n²) is the right call at this scale: a query bundle is 20 items and an
 * event is rarely past 200. A quadtree would cost more in complexity than it
 * saves in milliseconds, and the simulation is stopped once it settles.
 */
export function stepLayout(graph: GraphData, options: LayoutOptions = DEFAULT_LAYOUT): number {
  const { nodes, edges } = graph;
  const { linkStrength, repulsion, centering, damping } = options;

  // repulsion
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let dz = a.z - b.z;
      let distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq < 0.0001) {
        // Coincident nodes get a deterministic nudge rather than a random one,
        // so the layout stays reproducible.
        dx = (hashUnit(a.id + b.id, 3) - 0.5) * 0.1;
        dy = (hashUnit(a.id + b.id, 4) - 0.5) * 0.1;
        dz = (hashUnit(a.id + b.id, 5) - 0.5) * 0.1;
        distanceSq = dx * dx + dy * dy + dz * dz + 0.0001;
      }
      const distance = Math.sqrt(distanceSq);
      const force = repulsion / distanceSq;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      const fz = (dz / distance) * force;
      a.vx += fx; a.vy += fy; a.vz += fz;
      b.vx -= fx; b.vy -= fy; b.vz -= fz;
    }
  }

  // links — confirmed edges pull harder than tentative ones, so the layout
  // itself expresses relationship strength
  edges.forEach((edge) => {
    const a = graph.nodesById.get(edge.from);
    const b = graph.nodesById.get(edge.to);
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
    const rest = edge.status === "confirmed" ? 2.2 : 3.4;
    const strength = linkStrength * (edge.status === "confirmed" ? 1 : 0.45);
    const force = (distance - rest) * strength;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    const fz = (dz / distance) * force;
    a.vx += fx; a.vy += fy; a.vz += fz;
    b.vx -= fx; b.vy -= fy; b.vz -= fz;
  });

  // integrate
  let energy = 0;
  nodes.forEach((node) => {
    if (node.fixed) {
      node.vx = 0; node.vy = 0; node.vz = 0;
      return;
    }
    node.vx = (node.vx - node.x * centering) * damping;
    node.vy = (node.vy - node.y * centering) * damping;
    node.vz = (node.vz - node.z * centering) * damping;
    // Velocity clamp keeps a bad initial state from launching nodes offscreen.
    const speed = Math.hypot(node.vx, node.vy, node.vz);
    if (speed > 1.2) {
      const scale = 1.2 / speed;
      node.vx *= scale; node.vy *= scale; node.vz *= scale;
    }
    node.x += node.vx;
    node.y += node.vy;
    node.z += node.vz;
    energy += speed;
  });

  return energy / Math.max(1, nodes.length);
}

/** Runs the layout to convergence (or the iteration cap) before first paint,
 *  so the graph arrives settled instead of visibly thrashing. */
export function settleLayout(graph: GraphData, iterations = 320, options: LayoutOptions = DEFAULT_LAYOUT): void {
  for (let i = 0; i < iterations; i += 1) {
    if (stepLayout(graph, options) < 0.0015) break;
  }
}

// ── derived stats ──────────────────────────────────────────────────────────

export interface GraphStats {
  byModality: Record<string, number>;
  byRelationshipType: { type: string; count: number; confirmed: number }[];
  confirmedCount: number;
  tentativeCount: number;
  /** Mean confidence of confirmed edges only — averaging in tentative ones
   *  would understate the strength of what the linker actually committed to. */
  meanConfirmedConfidence: number | null;
  timeRange: { startMs: number; endMs: number } | null;
  /** Fraction of nodes carrying a full provenance record. */
  provenanceCompleteness: number | null;
  signals: string[];
}

export function computeStats(graph: GraphData): GraphStats {
  const byModality: Record<string, number> = {};
  let withProvenance = 0;
  let evidenceCount = 0;
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;

  graph.nodes.forEach((node) => {
    if (node.kind !== "observation" && node.kind !== "segment") return;
    evidenceCount += 1;
    if (node.modality) byModality[node.modality] = (byModality[node.modality] ?? 0) + 1;
    if (node.evidence?.provenance?.producer) withProvenance += 1;
    if (node.startMs !== null) {
      minStart = Math.min(minStart, node.startMs);
      maxEnd = Math.max(maxEnd, node.endMs ?? node.startMs);
    }
  });

  const typeMap = new Map<string, { count: number; confirmed: number }>();
  let confirmedCount = 0;
  let tentativeCount = 0;
  let confidenceSum = 0;
  const signals = new Set<string>();

  graph.edges.forEach((edge) => {
    const entry = typeMap.get(edge.type) ?? { count: 0, confirmed: 0 };
    entry.count += 1;
    if (edge.status === "confirmed") {
      entry.confirmed += 1;
      confirmedCount += 1;
      confidenceSum += edge.confidence;
    } else if (edge.status === "tentative") {
      tentativeCount += 1;
    }
    typeMap.set(edge.type, entry);
    Object.entries(edge.signals ?? {}).forEach(([key, value]) => {
      if (value !== null && value !== undefined) signals.add(key);
    });
  });

  return {
    byModality,
    byRelationshipType: [...typeMap.entries()]
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.count - a.count),
    confirmedCount,
    tentativeCount,
    meanConfirmedConfidence: confirmedCount > 0 ? confidenceSum / confirmedCount : null,
    timeRange: Number.isFinite(minStart) && Number.isFinite(maxEnd) ? { startMs: minStart, endMs: maxEnd } : null,
    provenanceCompleteness: evidenceCount > 0 ? withProvenance / evidenceCount : null,
    signals: [...signals].sort(),
  };
}

/** Colour for a node, matching the modality encoding used everywhere else. */
export function nodeColor(node: GraphNode): string {
  if (node.kind === "event") return "#19D6C4";
  if (node.kind === "source") return "#8B96A8";
  if (node.kind === "entity") return "#7A6DC9";
  return modalityMeta(node.modality).hex;
}

/** Radius from relevance: bundle score where present, otherwise confidence,
 *  otherwise a fixed base. Never zero — an unscored node still exists. */
export function nodeRadius(node: GraphNode): number {
  if (node.kind === "event") return 0.42;
  if (node.kind === "source") return 0.26;
  const relevance = node.score ?? node.confidence ?? 0.4;
  return 0.13 + Math.min(1, Math.max(0, relevance)) * 0.19;
}
