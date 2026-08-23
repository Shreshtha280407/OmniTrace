import { describe, expect, it } from "vitest";

import { buildGraph, computeStats, nodeRadius, settleLayout } from "@/components/graph/model";
import type { EvidenceItem, Relationship, SemanticEvent } from "@/lib/api/schemas";

function ev(id: string, over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    _id: id,
    source_id: "src_1",
    node_type: "atomic_observation",
    evidence_type: "utterance",
    modality: "speech",
    content: `content ${id}`,
    location: {},
    member_evidence_ids: [],
    entity_ids: [],
    confidence: { extraction: 0.9 },
    provenance: { processing_run_id: "run_1", producer: "pipeline.audio", derived_from: [] },
    ...over,
  } as EvidenceItem;
}

function rel(id: string, from: string, to: string, over: Partial<Relationship> = {}): Relationship {
  return {
    _id: id,
    from_id: from,
    to_id: to,
    type: "EXPLAINS",
    status: "confirmed",
    confidence: 0.9,
    signals: { temporal: 0.8 },
    ...over,
  } as Relationship;
}

describe("buildGraph", () => {
  it("creates a node per evidence item and distinguishes segments", () => {
    const graph = buildGraph({
      evidence: [ev("ev_1"), ev("ev_2", { node_type: "semantic_segment" })],
      relationships: [],
    });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodesById.get("ev_1")?.kind).toBe("observation");
    expect(graph.nodesById.get("ev_2")?.kind).toBe("segment");
  });

  it("drops an edge whose endpoint is not in the bundle", () => {
    // Drawing it would put a line into empty space and imply a node exists.
    const graph = buildGraph({
      evidence: [ev("ev_1")],
      relationships: [rel("rel_1", "ev_1", "ev_missing")],
    });
    expect(graph.edges).toHaveLength(0);
  });

  it("adds membership edges from the event to each member present", () => {
    const event = {
      _id: "evt_1",
      title: "Cache proposal",
      summary: "",
      event_type: "discussion",
      source_ids: [],
      member_ids: ["ev_1", "ev_absent"],
      claim_ids: [],
      confidence: 0.88,
    } as unknown as SemanticEvent;

    const graph = buildGraph({ evidence: [ev("ev_1")], relationships: [], event });
    expect(graph.nodesById.get("evt_1")?.kind).toBe("event");
    // Only the member actually present becomes an edge.
    expect(graph.edges.filter((e) => e.type === "PART_OF_EVENT")).toHaveLength(1);
  });

  it("pins the event so it anchors the layout", () => {
    const event = { _id: "evt_1", title: "t", member_ids: [], confidence: 0.5 } as unknown as SemanticEvent;
    const graph = buildGraph({ evidence: [], relationships: [], event });
    expect(graph.nodesById.get("evt_1")?.fixed).toBe(true);
  });

  it("marks seeds, so expansion-only nodes are distinguishable", () => {
    const graph = buildGraph({
      evidence: [ev("ev_1"), ev("ev_2")],
      relationships: [],
      seedIds: new Set(["ev_1"]),
    });
    expect(graph.nodesById.get("ev_1")?.seed).toBe(true);
    expect(graph.nodesById.get("ev_2")?.seed).toBe(false);
  });

  it("builds symmetric adjacency for 1-hop highlighting", () => {
    const graph = buildGraph({
      evidence: [ev("ev_1"), ev("ev_2")],
      relationships: [rel("rel_1", "ev_1", "ev_2")],
    });
    expect(graph.neighbours.get("ev_1")?.has("ev_2")).toBe(true);
    expect(graph.neighbours.get("ev_2")?.has("ev_1")).toBe(true);
  });

  it("produces a stable initial layout for the same input", () => {
    const build = () => buildGraph({ evidence: [ev("ev_1"), ev("ev_2")], relationships: [] });
    const a = build();
    const b = build();
    expect(a.nodes[0].x).toBe(b.nodes[0].x);
    expect(a.nodes[1].y).toBe(b.nodes[1].y);
  });
});

describe("computeStats", () => {
  const evidence = [
    ev("ev_1", { modality: "speech", location: { start_ms: 1000, end_ms: 2000 } }),
    ev("ev_2", { modality: "document", location: { page: 7 } }),
    ev("ev_3", { modality: "video_visual", location: { start_ms: 5000, end_ms: 9000 } }),
  ];
  const relationships = [
    rel("rel_1", "ev_1", "ev_3", { status: "confirmed", confidence: 0.9 }),
    rel("rel_2", "ev_2", "ev_1", { status: "tentative", confidence: 0.2, type: "MENTIONS" }),
    rel("rel_3", "ev_3", "ev_2", { status: "confirmed", confidence: 0.7, type: "MENTIONS" }),
  ];

  it("counts evidence by modality", () => {
    const stats = computeStats(buildGraph({ evidence, relationships }));
    expect(stats.byModality).toEqual({ speech: 1, document: 1, video_visual: 1 });
  });

  it("averages confidence over confirmed edges only", () => {
    // Including tentative edges would understate what the linker committed to.
    const stats = computeStats(buildGraph({ evidence, relationships }));
    expect(stats.confirmedCount).toBe(2);
    expect(stats.tentativeCount).toBe(1);
    expect(stats.meanConfirmedConfidence).toBeCloseTo(0.8, 5);
  });

  it("derives the time range from time-bearing evidence only", () => {
    // The page-located document must not drag the range to zero.
    const stats = computeStats(buildGraph({ evidence, relationships }));
    expect(stats.timeRange).toEqual({ startMs: 1000, endMs: 9000 });
  });

  it("reports no time range when nothing is time-bearing", () => {
    const stats = computeStats(buildGraph({ evidence: [ev("ev_2", { location: { page: 3 } })], relationships: [] }));
    expect(stats.timeRange).toBeNull();
  });

  it("measures provenance completeness against evidence nodes", () => {
    const withGap = [...evidence, ev("ev_4", { provenance: undefined })];
    const stats = computeStats(buildGraph({ evidence: withGap, relationships: [] }));
    expect(stats.provenanceCompleteness).toBeCloseTo(3 / 4, 5);
  });

  it("lists only the signals the API actually populated", () => {
    const stats = computeStats(buildGraph({ evidence, relationships }));
    expect(stats.signals).toEqual(["temporal"]);
  });

  it("groups relationship types with confirmed counts", () => {
    const stats = computeStats(buildGraph({ evidence, relationships }));
    const mentions = stats.byRelationshipType.find((t) => t.type === "MENTIONS");
    expect(mentions).toEqual({ type: "MENTIONS", count: 2, confirmed: 1 });
  });
});

describe("nodeRadius", () => {
  it("scales with bundle score", () => {
    const graph = buildGraph({
      evidence: [ev("low", { score: 0.1 }), ev("high", { score: 0.95 })],
      relationships: [],
    });
    const low = nodeRadius(graph.nodesById.get("low")!);
    const high = nodeRadius(graph.nodesById.get("high")!);
    expect(high).toBeGreaterThan(low);
  });

  it("never returns zero for an unscored node", () => {
    const graph = buildGraph({ evidence: [ev("none", { score: null, confidence: {} })], relationships: [] });
    expect(nodeRadius(graph.nodesById.get("none")!)).toBeGreaterThan(0);
  });
});

describe("settleLayout", () => {
  it("separates nodes that started close together", () => {
    const graph = buildGraph({ evidence: [ev("ev_1"), ev("ev_2"), ev("ev_3")], relationships: [] });
    graph.nodes.forEach((n) => {
      n.x = 0; n.y = 0; n.z = 0;
    });
    settleLayout(graph, 200);
    const [a, b] = graph.nodes;
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(0.5);
  });

  it("leaves the pinned event at the origin", () => {
    const event = { _id: "evt_1", title: "t", member_ids: ["ev_1"], confidence: 0.5 } as unknown as SemanticEvent;
    const graph = buildGraph({ evidence: [ev("ev_1")], relationships: [], event });
    settleLayout(graph, 200);
    const node = graph.nodesById.get("evt_1")!;
    expect(node.x).toBe(0);
    expect(node.y).toBe(0);
  });

  it("produces finite positions for every node", () => {
    const evidence = Array.from({ length: 25 }, (_, i) => ev(`ev_${i}`));
    const graph = buildGraph({ evidence, relationships: [] });
    settleLayout(graph);
    graph.nodes.forEach((n) => {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(Number.isFinite(n.z)).toBe(true);
    });
  });
});
