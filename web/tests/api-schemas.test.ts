import { describe, expect, it } from "vitest";

import {
  EvidenceItemSchema,
  JobStatusSchema,
  QueryResponseSchema,
  SourceCreateResponseSchema,
  SourceEvidenceResponseSchema,
  SourceLocatorSchema,
  SourceSchema,
} from "@/lib/api/schemas";

/**
 * API contract parsing.
 *
 * These assert the two properties the whole interface depends on: that a
 * document's absent timestamp stays absent, and that a partial response gets
 * usable defaults instead of throwing.
 */

describe("SourceSchema", () => {
  const base = {
    _id: "src_01JQZK8V",
    collection_id: "demo_architecture",
    filename: "review.mp4",
    media_type: "video",
    mime_type: "video/mp4",
    sha256: "abc123",
    size_bytes: 1024,
    status: "ready",
    storage_path: "data/assets/src/raw/review.mp4",
  };

  it("parses a complete source record", () => {
    const parsed = SourceSchema.parse({ ...base, duration_ms: 431000, timeline_id: "tl_1" });
    expect(parsed.duration_ms).toBe(431000);
    expect(parsed.status).toBe("ready");
  });

  it("keeps page_count null for a video rather than defaulting it to 0", () => {
    const parsed = SourceSchema.parse({ ...base, page_count: null });
    expect(parsed.page_count).toBeNull();
    expect(parsed.page_count).not.toBe(0);
  });

  it("falls back to 'uploaded' for a status this client does not know", () => {
    // A newer backend adding a status must not break the whole response.
    const parsed = SourceSchema.parse({ ...base, status: "reticulating" });
    expect(parsed.status).toBe("uploaded");
  });

  it("preserves unknown fields instead of stripping them", () => {
    const parsed = SourceSchema.parse({ ...base, future_field: 42 });
    expect((parsed as Record<string, unknown>).future_field).toBe(42);
  });
});

describe("EvidenceItemSchema", () => {
  const provenance = { processing_run_id: "run_1", producer: "pipeline.audio" };

  it("keeps a speech locator's millisecond range", () => {
    const parsed = EvidenceItemSchema.parse({
      _id: "ev_1",
      source_id: "src_1",
      node_type: "atomic_observation",
      evidence_type: "utterance",
      modality: "speech",
      content: "hello",
      location: { timeline_id: "tl_1", start_ms: 104200, end_ms: 121900 },
      provenance,
    });
    expect(parsed.location.start_ms).toBe(104200);
    expect(parsed.location.page).toBeUndefined();
  });

  it("leaves start_ms absent on a document block", () => {
    // The rule that makes SourceLocator honest: a page-located record must
    // never come back with a zero timestamp.
    const parsed = EvidenceItemSchema.parse({
      _id: "ev_2",
      source_id: "src_2",
      node_type: "atomic_observation",
      evidence_type: "document_block",
      modality: "document",
      content: "trade-offs",
      location: { page: 7, bbox_norm: { x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.4 } },
      provenance,
    });
    expect(parsed.location.page).toBe(7);
    expect(parsed.location.start_ms).toBeUndefined();
    expect(parsed.location.bbox_norm?.x2).toBe(0.9);
  });

  it("defaults collections of ids to empty arrays", () => {
    const parsed = EvidenceItemSchema.parse({
      _id: "ev_3",
      source_id: "src_3",
      node_type: "semantic_segment",
      evidence_type: "semantic_segment",
      modality: "speech",
      content: "",
      location: {},
      provenance,
    });
    expect(parsed.member_evidence_ids).toEqual([]);
    expect(parsed.entity_ids).toEqual([]);
  });
});

describe("SourceLocatorSchema", () => {
  it("accepts the hydrated shape, which keys on `id` rather than `_id`", () => {
    const parsed = SourceLocatorSchema.parse({
      id: "ev_1",
      source_id: "src_1",
      node_type: "atomic_observation",
      evidence_type: "utterance",
      modality: "speech",
      content: "hello",
      location: { start_ms: 1000, end_ms: 2000 },
      provenance: { processing_run_id: "run_1", producer: "pipeline.audio" },
    });
    expect(parsed.id).toBe("ev_1");
  });
});

describe("JobStatusSchema", () => {
  it("parses the stage map returned by GET /jobs/{id}", () => {
    const parsed = JobStatusSchema.parse({
      job_id: "src_1",
      source_id: "src_1",
      source_status: "ready",
      stages: {
        probe: { status: "ok", started_at: "2026-03-14T09:12:00Z", ended_at: "2026-03-14T09:12:01Z", warnings: [] },
        visual: { status: "failed", started_at: null, ended_at: null, warnings: ["x"], error: "boom" },
      },
    });
    expect(parsed.stages.probe.status).toBe("ok");
    expect(parsed.stages.visual.error).toBe("boom");
  });

  it("tolerates a job with no runs recorded yet", () => {
    const parsed = JobStatusSchema.parse({ job_id: "j", source_id: "s", source_status: "uploaded" });
    expect(parsed.stages).toEqual({});
  });
});

describe("QueryResponseSchema", () => {
  it("fills defaults for every optional field on a minimal response", () => {
    const parsed = QueryResponseSchema.parse({});
    expect(parsed.answer).toBe("");
    expect(parsed.claims).toEqual([]);
    expect(parsed.evidence).toEqual([]);
    expect(parsed.support_label).toBe("none");
    expect(parsed.query_plan.answer_slots).toEqual([]);
    expect(parsed.stage_timings_ms).toEqual({});
  });

  it("parses a full response with claims, timings and a plan", () => {
    const parsed = QueryResponseSchema.parse({
      answer: "A Redis read-through cache.",
      claims: [{ text: "It is Redis.", evidence_ids: ["ev_1"], support: "high" }],
      conflicts: [],
      missing_information: ["who approved it"],
      primary_event_id: "evt_1",
      evidence: [],
      relationships: [],
      source_locators: [],
      support_label: "high",
      stage_timings_ms: { plan: 3, seed: 412, generate: 4286 },
      query_plan: {
        answer_slots: ["who", "architecture"],
        required_modalities: ["speech"],
        entity_ids: ["ent_redis"],
        channel_weights: { lexical: 1, visual_vector: 2 },
      },
    });
    expect(parsed.claims[0].support).toBe("high");
    expect(parsed.stage_timings_ms.generate).toBe(4286);
    expect(parsed.query_plan.channel_weights.visual_vector).toBe(2);
    expect(parsed.missing_information).toHaveLength(1);
  });

  it("coerces an unrecognised support level to the lowest, never the highest", () => {
    const parsed = QueryResponseSchema.parse({
      claims: [{ text: "x", evidence_ids: ["ev_1"], support: "extremely-high" }],
    });
    expect(parsed.claims[0].support).toBe("low");
  });

  it("rejects a response whose claims are not an array", () => {
    expect(() => QueryResponseSchema.parse({ claims: "nope" })).toThrow();
  });
});

describe("SourceCreateResponseSchema", () => {
  it("requires every field the upload flow depends on", () => {
    expect(() => SourceCreateResponseSchema.parse({ source_id: "s", job_id: "s" })).toThrow();
    const parsed = SourceCreateResponseSchema.parse({
      source_id: "src_1",
      job_id: "src_1",
      checksum: "abc",
      status: "ready",
    });
    expect(parsed.job_id).toBe(parsed.source_id);
  });
});

describe("SourceEvidenceResponseSchema", () => {
  it("parses the listing envelope", () => {
    const parsed = SourceEvidenceResponseSchema.parse({ source_id: "src_1", count: 0, evidence: [] });
    expect(parsed.count).toBe(0);
  });
});
